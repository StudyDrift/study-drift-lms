package geoip

import (
	"net"
	"testing"
)

func TestCityCountry(t *testing.T) {
	cases := []struct {
		name string
		ip   net.IP
	}{
		{"nil", nil},
		{"unspecified v4", net.IPv4zero},
		{"unspecified v6", net.IPv6unspecified},
		{"loopback v4", net.ParseIP("127.0.0.1")},
		{"loopback v6", net.ParseIP("::1")},
		{"private 10/8", net.ParseIP("10.0.0.1")},
		{"private 192.168/16", net.ParseIP("192.168.1.1")},
		{"private 172.16/12", net.ParseIP("172.16.0.1")},
		{"link local", net.ParseIP("169.254.1.1")},
		{"public", net.ParseIP("8.8.8.8")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			city, country := CityCountry(c.ip)
			if city != "" || country != "" {
				t.Fatalf("expected empty, got %q %q", city, country)
			}
		})
	}
}
