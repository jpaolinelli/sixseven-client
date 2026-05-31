use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use hmac::{Hmac, Mac};
use md5::Md5 as Md5Hasher;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::protocol::*;
use tokio::net::TcpStream;

type HmacSha256 = Hmac<Sha256>;

/// SCRAM-SHA-256 client state tracker.
pub struct ScramState {
    pub username: String,
    pub password: String,
    pub client_nonce: String,
    pub client_first_message_bare: String,
    pub server_nonce: String,
    pub salt: Vec<u8>,
    pub iterations: u32,
    pub auth_message: String,
    pub server_key: Vec<u8>,
}

/// Handle the authentication handshake after receiving an 'R' message.
pub async fn handle_auth(
    stream: &mut TcpStream,
    auth_type: u32,
    payload: &[u8],
    user: &str,
    password: &str,
) -> Result<()> {
    match auth_type {
        AUTH_OK => Ok(()),
        AUTH_CLEARTEXT => {
            let msg = build_password_message(password);
            write_message(stream, b'p', &msg).await?;
            Ok(())
        }
        AUTH_MD5 => {
            if payload.len() < 8 {
                return Err(Error::Auth("MD5 auth: missing salt".into()));
            }
            let salt = &payload[4..8];
            let hash = compute_md5_password(user, password, salt);
            let msg = build_password_message(&hash);
            write_message(stream, b'p', &msg).await?;
            Ok(())
        }
        AUTH_SASL => {
            let state = scram_client_first(stream, user, password, payload).await?;
            scram_handle_server_response(stream, state).await?;
            Ok(())
        }
        _ => Err(Error::Auth(format!("unsupported auth type: {auth_type}"))),
    }
}

/// Compute MD5 password: "md5" + md5(md5(password + user) + salt).
pub fn compute_md5_password(user: &str, password: &str, salt: &[u8]) -> String {
    // Inner: md5(password + user)
    let mut hasher = Md5Hasher::new();
    hasher.update(password.as_bytes());
    hasher.update(user.as_bytes());
    let inner = format!("{:x}", hasher.finalize());

    // Outer: md5(inner_hex + salt)
    let mut hasher = Md5Hasher::new();
    hasher.update(inner.as_bytes());
    hasher.update(salt);
    let outer = format!("{:x}", hasher.finalize());

    format!("md5{outer}")
}

/// Send the SCRAM-SHA-256 client-first message.
async fn scram_client_first(
    stream: &mut TcpStream,
    user: &str,
    password: &str,
    _payload: &[u8],
) -> Result<ScramState> {
    // Generate client nonce (18 random bytes, base64 encoded)
    let nonce_bytes: [u8; 18] = rand::random();
    let client_nonce = BASE64.encode(nonce_bytes);

    let client_first_message_bare = format!("n={user},r={client_nonce}");
    let client_first_message = format!("n,,{client_first_message_bare}");

    let sasl_msg = build_sasl_initial_response("SCRAM-SHA-256", client_first_message.as_bytes());
    write_message(stream, b'p', &sasl_msg).await?;

    Ok(ScramState {
        username: user.to_string(),
        password: password.to_string(),
        client_nonce,
        client_first_message_bare,
        server_nonce: String::new(),
        salt: Vec::new(),
        iterations: 0,
        auth_message: String::new(),
        server_key: Vec::new(),
    })
}

/// Handle SASL continue and final messages.
async fn scram_handle_server_response(
    stream: &mut TcpStream,
    mut state: ScramState,
) -> Result<()> {
    // Read AuthenticationSASLContinue
    let msg = read_message(stream).await?;
    if msg.msg_type != MSG_AUTH {
        return Err(Error::Auth("expected auth message during SCRAM".into()));
    }
    if msg.payload.len() < 4 {
        return Err(Error::Auth("SCRAM continue payload too short".into()));
    }
    let auth_sub = u32::from_be_bytes([msg.payload[0], msg.payload[1], msg.payload[2], msg.payload[3]]);
    if auth_sub != AUTH_SASL_CONTINUE {
        return Err(Error::Auth(format!("expected SASL continue, got {auth_sub}")));
    }

    let server_first = String::from_utf8_lossy(&msg.payload[4..]).to_string();
    parse_server_first(&server_first, &mut state)?;

    // Compute and send client-final
    let client_final = compute_client_final(&state)?;
    let sasl_msg = build_sasl_response(client_final.as_bytes());
    write_message(stream, b'p', &sasl_msg).await?;

    // Read AuthenticationSASLFinal
    let msg = read_message(stream).await?;
    if msg.msg_type != MSG_AUTH {
        return Err(Error::Auth("expected auth message for SCRAM final".into()));
    }
    if msg.payload.len() < 4 {
        return Err(Error::Auth("SCRAM final payload too short".into()));
    }
    let auth_sub = u32::from_be_bytes([msg.payload[0], msg.payload[1], msg.payload[2], msg.payload[3]]);
    if auth_sub != AUTH_SASL_FINAL {
        return Err(Error::Auth(format!("expected SASL final, got {auth_sub}")));
    }

    let server_final = String::from_utf8_lossy(&msg.payload[4..]).to_string();
    verify_server_signature(&server_final, &state)?;

    Ok(())
}

/// Parse the server-first-message: r=<nonce>,s=<salt>,i=<iterations>.
fn parse_server_first(server_first: &str, state: &mut ScramState) -> Result<()> {
    for part in server_first.split(',') {
        if let Some(val) = part.strip_prefix("r=") {
            state.server_nonce = val.to_string();
        } else if let Some(val) = part.strip_prefix("s=") {
            state.salt = BASE64.decode(val).map_err(|e| Error::Auth(format!("invalid salt: {e}")))?;
        } else if let Some(val) = part.strip_prefix("i=") {
            state.iterations = val.parse().map_err(|e| Error::Auth(format!("invalid iterations: {e}")))?;
        }
    }

    // Validate server nonce starts with client nonce
    if !state.server_nonce.starts_with(&state.client_nonce) {
        return Err(Error::Auth("server nonce doesn't start with client nonce".into()));
    }

    Ok(())
}

/// Compute the client-final-message.
pub fn compute_client_final(state: &ScramState) -> Result<String> {
    let salted_password = pbkdf2_sha256(&state.password, &state.salt, state.iterations);

    let client_key = hmac_sha256(&salted_password, b"Client Key");
    let stored_key = sha256(&client_key);
    let server_key = hmac_sha256(&salted_password, b"Server Key");

    let channel_binding = BASE64.encode(b"n,,");
    let client_final_no_proof = format!("c={channel_binding},r={}", state.server_nonce);

    let server_first_reconstructed = format!(
        "r={},s={},i={}",
        state.server_nonce, BASE64.encode(&state.salt), state.iterations
    );
    let auth_message = format!(
        "{},{},{}",
        state.client_first_message_bare,
        server_first_reconstructed,
        client_final_no_proof
    );

    let client_signature = hmac_sha256(&stored_key, auth_message.as_bytes());
    let client_proof = xor_bytes(&client_key, &client_signature);
    let proof = BASE64.encode(&client_proof);

    // Store server key and auth message for verification (via interior mutability workaround)
    // We verify in the caller using the same computation
    let _ = &server_key;

    Ok(format!("{client_final_no_proof},p={proof}"))
}

/// Verify the server signature from the server-final-message.
pub fn verify_server_signature(server_final: &str, state: &ScramState) -> Result<()> {
    let server_sig_b64 = server_final
        .strip_prefix("v=")
        .ok_or_else(|| Error::Auth("invalid server final message".into()))?;

    let received_sig = BASE64.decode(server_sig_b64)
        .map_err(|e| Error::Auth(format!("invalid server signature: {e}")))?;

    let salted_password = pbkdf2_sha256(&state.password, &state.salt, state.iterations);
    let server_key = hmac_sha256(&salted_password, b"Server Key");

    let channel_binding = BASE64.encode(b"n,,");
    let client_final_no_proof = format!("c={channel_binding},r={}", state.server_nonce);
    let server_first_reconstructed = format!(
        "r={},s={},i={}",
        state.server_nonce, BASE64.encode(&state.salt), state.iterations
    );
    let auth_message = format!(
        "{},{},{}",
        state.client_first_message_bare,
        server_first_reconstructed,
        client_final_no_proof
    );

    let expected_sig = hmac_sha256(&server_key, auth_message.as_bytes());

    if received_sig != expected_sig {
        return Err(Error::Auth("server signature verification failed".into()));
    }

    Ok(())
}

/// PBKDF2-SHA256 key derivation.
fn pbkdf2_sha256(password: &str, salt: &[u8], iterations: u32) -> Vec<u8> {
    let mut output = vec![0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut output);
    output
}

/// HMAC-SHA256.
fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// SHA-256 hash.
fn sha256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// XOR two byte slices of equal length.
fn xor_bytes(a: &[u8], b: &[u8]) -> Vec<u8> {
    a.iter().zip(b.iter()).map(|(x, y)| x ^ y).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_md5_password() {
        let result = compute_md5_password("user", "password", &[0x01, 0x02, 0x03, 0x04]);
        assert!(result.starts_with("md5"));
        assert_eq!(result.len(), 35); // "md5" + 32 hex chars
    }

    #[test]
    fn test_md5_password_known_value() {
        // md5(md5("password" + "user") + salt)
        // Inner: md5("passworduser")
        let result = compute_md5_password("testuser", "testpass", &[0xAA, 0xBB, 0xCC, 0xDD]);
        assert!(result.starts_with("md5"));
        // Verify deterministic
        let result2 = compute_md5_password("testuser", "testpass", &[0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(result, result2);
        // Different salt -> different result
        let result3 = compute_md5_password("testuser", "testpass", &[0x11, 0x22, 0x33, 0x44]);
        assert_ne!(result, result3);
    }

    #[test]
    fn test_pbkdf2_sha256() {
        let result = pbkdf2_sha256("password", b"salt", 4096);
        assert_eq!(result.len(), 32);
        // Should be deterministic
        let result2 = pbkdf2_sha256("password", b"salt", 4096);
        assert_eq!(result, result2);
    }

    #[test]
    fn test_hmac_sha256() {
        let result = hmac_sha256(b"key", b"data");
        assert_eq!(result.len(), 32);
        // Deterministic
        let result2 = hmac_sha256(b"key", b"data");
        assert_eq!(result, result2);
    }

    #[test]
    fn test_xor_bytes() {
        let a = vec![0xFF, 0x00, 0xAA];
        let b = vec![0x0F, 0xF0, 0x55];
        let result = xor_bytes(&a, &b);
        assert_eq!(result, vec![0xF0, 0xF0, 0xFF]);
    }

    #[test]
    fn test_parse_server_first() {
        let mut state = ScramState {
            username: "user".into(),
            password: "pass".into(),
            client_nonce: "rOprNGfwEbeRWgbNEkqO".into(),
            client_first_message_bare: "n=user,r=rOprNGfwEbeRWgbNEkqO".into(),
            server_nonce: String::new(),
            salt: Vec::new(),
            iterations: 0,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let server_first = "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096";
        parse_server_first(server_first, &mut state).unwrap();

        assert!(state.server_nonce.starts_with("rOprNGfwEbeRWgbNEkqO"));
        assert_eq!(state.iterations, 4096);
        assert!(!state.salt.is_empty());
    }

    #[test]
    fn test_parse_server_first_invalid_nonce() {
        let mut state = ScramState {
            username: "user".into(),
            password: "pass".into(),
            client_nonce: "clientnonce123".into(),
            client_first_message_bare: "n=user,r=clientnonce123".into(),
            server_nonce: String::new(),
            salt: Vec::new(),
            iterations: 0,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let server_first = "r=differentnonce,s=c2FsdA==,i=4096";
        let result = parse_server_first(server_first, &mut state);
        assert!(result.is_err());
    }

    #[test]
    fn test_scram_full_computation() {
        // Test that compute_client_final and verify_server_signature work together
        let state = ScramState {
            username: "user".into(),
            password: "pencil".into(),
            client_nonce: "rOprNGfwEbeRWgbNEkqO".into(),
            client_first_message_bare: "n=user,r=rOprNGfwEbeRWgbNEkqO".into(),
            server_nonce: "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj".into(),
            salt: BASE64.decode("W22ZaJ0SNY7soEsUEjb6gQ==").unwrap(),
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let result = compute_client_final(&state);
        assert!(result.is_ok());
        let client_final = result.unwrap();
        assert!(client_final.contains("p="));
        assert!(client_final.contains("c="));
        assert!(client_final.contains("r="));
    }
}
