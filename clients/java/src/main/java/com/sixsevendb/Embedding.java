package com.sixsevendb;

import java.util.Arrays;

/**
 * Represents a vector embedding as an array of float values.
 */
public final class Embedding {

    private final float[] values;

    public Embedding(float[] values) {
        this.values = values != null ? values.clone() : new float[0];
    }

    public float[] getValues() {
        return values.clone();
    }

    public int dimensions() {
        return values.length;
    }

    /** Parses a text-format embedding "[0.1,0.2,0.3]" into an Embedding. */
    public static Embedding parse(String s) {
        if (s == null) return new Embedding(new float[0]);
        s = s.trim();
        if (s.startsWith("[") && s.endsWith("]")) {
            s = s.substring(1, s.length() - 1);
        }
        if (s.isEmpty()) return new Embedding(new float[0]);
        String[] parts = s.split(",");
        float[] result = new float[parts.length];
        for (int i = 0; i < parts.length; i++) {
            result[i] = Float.parseFloat(parts[i].trim());
        }
        return new Embedding(result);
    }

    /** Serializes the embedding to text format "[0.1,0.2,0.3]". */
    public String serialize() {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(values[i]);
        }
        sb.append("]");
        return sb.toString();
    }

    @Override
    public String toString() {
        return serialize();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Embedding)) return false;
        return Arrays.equals(values, ((Embedding) o).values);
    }

    @Override
    public int hashCode() {
        return Arrays.hashCode(values);
    }
}
