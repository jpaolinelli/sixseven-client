use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput, Data, Fields};

/// Derive macro that generates a `FromRow` implementation for a struct.
///
/// Each field in the struct is mapped by name from the query result columns.
/// Fields must implement `TryFrom<sixsevendb::Value>`.
///
/// # Example
///
/// ```rust,ignore
/// use sixsevendb::FromRow;
///
/// #[derive(FromRow)]
/// struct User {
///     id: i32,
///     name: String,
///     email: String,
/// }
/// ```
#[proc_macro_derive(FromRow)]
pub fn derive_from_row(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    let fields = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(fields) => &fields.named,
            _ => panic!("FromRow can only be derived for structs with named fields"),
        },
        _ => panic!("FromRow can only be derived for structs"),
    };

    let field_extractions = fields.iter().map(|f| {
        let field_name = f.ident.as_ref().unwrap();
        let field_name_str = field_name.to_string();
        let field_type = &f.ty;

        quote! {
            #field_name: {
                let col_idx = field_indices.get(#field_name_str)
                    .ok_or_else(|| sixsevendb::Error::Type(
                        format!("column '{}' not found in result", #field_name_str)
                    ))?;
                let value = row.get(*col_idx)
                    .cloned()
                    .unwrap_or(sixsevendb::Value::Null);
                <#field_type as sixsevendb::FromValue>::from_value(value)
                    .map_err(|e| sixsevendb::Error::Type(
                        format!("column '{}': {}", #field_name_str, e)
                    ))?
            }
        }
    });

    let expanded = quote! {
        impl #impl_generics sixsevendb::FromRow for #name #ty_generics #where_clause {
            fn from_row(
                fields: &[sixsevendb::protocol::FieldDescription],
                row: &[sixsevendb::Value],
            ) -> sixsevendb::Result<Self> {
                let field_indices: std::collections::HashMap<&str, usize> = fields
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (f.name.as_str(), i))
                    .collect();

                Ok(Self {
                    #(#field_extractions,)*
                })
            }
        }
    };

    TokenStream::from(expanded)
}
