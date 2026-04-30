// Package browsersaml implements SAML 2.0 SP browser flows (metadata, login redirect, ACS)
// using github.com/crewjam/saml, matching server/src/services/auth/saml.rs behavior.
package browsersaml

import (
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"net/url"
	"strings"

	samllib "github.com/crewjam/saml"
	"github.com/crewjam/saml/samlsp"
	dsig "github.com/russellhaering/goxmldsig"

	"github.com/lextures/lextures/server/internal/config"
)

// IDPMetadataXMLFromRow matches Rust `idp_row_to_metadata_xml` (minimal EntityDescriptor).
func IDPMetadataXMLFromRow(entityID, ssoURL, idpCertPEM string) (string, error) {
	certB64, err := pemBodyB64(idpCertPEM)
	if err != nil {
		return "", err
	}
	ent := xmlEscape(entityID)
	sso := xmlEscape(ssoURL)
	return fmt.Sprintf(
		`<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  entityID="%s">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo>
        <ds:X509Data>
          <ds:X509Certificate>%s</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="%s"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`,
		ent, certB64, sso,
	), nil
}

func xmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}

func pemBodyB64(pemStr string) (string, error) {
	var b strings.Builder
	for _, line := range strings.Split(pemStr, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "-----") {
			continue
		}
		b.WriteString(strings.Map(func(r rune) rune {
			if r == ' ' || r == '\t' || r == '\r' {
				return -1
			}
			return r
		}, line))
	}
	s := b.String()
	if s == "" {
		return "", fmt.Errorf("X.509 PEM has no base64 body")
	}
	return s, nil
}

// ServiceProvider builds a crewjam SP from process config + parsed IdP metadata.
func ServiceProvider(cfg config.Config, idpMeta *samllib.EntityDescriptor) (*samllib.ServiceProvider, error) {
	base := strings.TrimRight(cfg.SAMLPublicBaseURL, "/")
	mdURL, err := url.Parse(cfg.SAMLSPEntityID)
	if err != nil {
		return nil, fmt.Errorf("entity id url: %w", err)
	}
	acsURL, _ := url.Parse(base + "/auth/saml/acs")
	sloURL, _ := url.Parse(base + "/auth/saml/slo")
	sp := samllib.ServiceProvider{
		EntityID:      cfg.SAMLSPEntityID,
		MetadataURL:     *mdURL,
		AcsURL:          *acsURL,
		SloURL:          *sloURL,
		IDPMetadata:     idpMeta,
		AuthnNameIDFormat: samllib.EmailAddressNameIDFormat,
		AllowIDPInitiated: true,
	}
	if strings.TrimSpace(cfg.SAMLSPPrivateKeyPEM) != "" && strings.TrimSpace(cfg.SAMLSPX509PEM) != "" {
		cert, err := tls.X509KeyPair([]byte(cfg.SAMLSPX509PEM), []byte(cfg.SAMLSPPrivateKeyPEM))
		if err != nil {
			return nil, fmt.Errorf("SAML SP X509/key pair: %w", err)
		}
		cert.Leaf, err = x509.ParseCertificate(cert.Certificate[0])
		if err != nil {
			return nil, err
		}
		key, ok := cert.PrivateKey.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("SAML SP private key must be RSA")
		}
		sp.Key = key
		sp.Certificate = cert.Leaf
		sp.SignatureMethod = dsig.RSASHA256SignatureMethod
	}
	return &sp, nil
}

// ParseIDPMetadata parses IdP EntityDescriptor XML (from row or file).
func ParseIDPMetadata(xmlStr string) (*samllib.EntityDescriptor, error) {
	return samlsp.ParseMetadata([]byte(strings.TrimSpace(xmlStr)))
}

// SPMetadataXML returns SP metadata for GET /auth/saml/metadata.
func SPMetadataXML(cfg config.Config) ([]byte, string, error) {
	// IDP is unused for SP metadata document generation in crewjam (see ServiceProvider.Metadata).
	sp, err := ServiceProvider(cfg, &samllib.EntityDescriptor{})
	if err != nil {
		return nil, "", err
	}
	out, err := xml.MarshalIndent(sp.Metadata(), "", "  ")
	if err != nil {
		return nil, "", err
	}
	return out, "application/samlmetadata+xml; charset=utf-8", nil
}

// LoadRSAPrivateKeyFromPEM loads PKCS#1 or PKCS#8 RSA key (helper for tests).
func LoadRSAPrivateKeyFromPEM(pemStr string) (*rsa.PrivateKey, error) {
	b, _ := pem.Decode([]byte(pemStr))
	if b == nil {
		return nil, fmt.Errorf("no PEM block")
	}
	if k, err := x509.ParsePKCS1PrivateKey(b.Bytes); err == nil {
		return k, nil
	}
	key, err := x509.ParsePKCS8PrivateKey(b.Bytes)
	if err != nil {
		return nil, err
	}
	rk, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("not RSA")
	}
	return rk, nil
}
