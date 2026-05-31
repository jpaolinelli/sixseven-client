package com.sixsevendb;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Represents a time interval with separate year/month/day/time components.
 */
public final class Interval {

    private final int years;
    private final int months;
    private final int days;
    private final int hours;
    private final int minutes;
    private final double seconds;

    public Interval(int years, int months, int days, int hours, int minutes, double seconds) {
        this.years = years;
        this.months = months;
        this.days = days;
        this.hours = hours;
        this.minutes = minutes;
        this.seconds = seconds;
    }

    public int getYears() { return years; }
    public int getMonths() { return months; }
    public int getDays() { return days; }
    public int getHours() { return hours; }
    public int getMinutes() { return minutes; }
    public double getSeconds() { return seconds; }

    /** Parses a PostgreSQL-format interval string. */
    public static Interval parse(String s) {
        if (s == null) return new Interval(0, 0, 0, 0, 0, 0);
        s = s.trim();

        // Handle "HH:MM:SS" format
        if (s.contains(":") && !s.toLowerCase().contains("day")) {
            return parseTime(s);
        }

        String lower = s.toLowerCase();
        if (lower.contains("day")) {
            String[] dayParts = lower.split("day", 2);
            int days = 0;
            try {
                days = Integer.parseInt(dayParts[0].trim());
            } catch (NumberFormatException ignored) {}
            String rest = dayParts[1].replaceFirst("^s?\\s*", "");
            if (!rest.isEmpty() && rest.contains(":")) {
                Interval timeIv = parseTime(rest);
                return new Interval(0, 0, days, timeIv.hours, timeIv.minutes, timeIv.seconds);
            }
            return new Interval(0, 0, days, 0, 0, 0);
        }

        // Try as raw seconds
        try {
            double sec = Double.parseDouble(s);
            return new Interval(0, 0, 0, 0, 0, sec);
        } catch (NumberFormatException e) {
            return new Interval(0, 0, 0, 0, 0, 0);
        }
    }

    private static Interval parseTime(String s) {
        String[] parts = s.trim().split(":");
        if (parts.length != 3) return new Interval(0, 0, 0, 0, 0, 0);
        try {
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            double sec = Double.parseDouble(parts[2].trim());
            return new Interval(0, 0, 0, h, m, sec);
        } catch (NumberFormatException e) {
            return new Interval(0, 0, 0, 0, 0, 0);
        }
    }

    @Override
    public String toString() {
        List<String> parts = new ArrayList<>();
        if (years != 0) parts.add(years + " years");
        if (months != 0) parts.add(months + " months");
        if (days != 0) parts.add(days + " days");
        if (hours != 0 || minutes != 0 || seconds != 0) {
            parts.add(String.format("%02d:%02d:%06.3f", hours, minutes, seconds));
        }
        if (parts.isEmpty()) return "0";
        return String.join(" ", parts);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Interval)) return false;
        Interval that = (Interval) o;
        return years == that.years && months == that.months && days == that.days
            && hours == that.hours && minutes == that.minutes
            && Double.compare(that.seconds, seconds) == 0;
    }

    @Override
    public int hashCode() {
        return Objects.hash(years, months, days, hours, minutes, seconds);
    }
}
