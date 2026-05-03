// Package geoip resolves approximate city/country from an IP for session UI (plan 4.9).
// When no local database is configured, returns empty strings (no third-party API calls).
package geoip

import "net"

// CityCountry returns best-effort "City" and "Country" labels; both may be empty.
func CityCountry(ip net.IP) (city, country string) {
	if ip == nil || ip.IsUnspecified() {
		return "", ""
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return "", ""
	}
	// Future: load MaxMind GeoLite2 from GEOIP_CITY_DB_PATH when set.
	return "", ""
}
