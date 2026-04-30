// imsmanifest.xml helpers (port of server/src/services/common_cartridge.rs).
package commoncartridge

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/beevik/etree"
)

// QtiXMLPathsFromManifest lists QTI resource hrefs from a Common Cartridge imsmanifest, joined to extractRoot.
func QtiXMLPathsFromManifest(manifestXML string, extractRoot string) ([]string, error) {
	doc := etree.NewDocument()
	if err := doc.ReadFromString(manifestXML); err != nil {
		return nil, err
	}
	var out []string
	root := doc.Root()
	if root == nil {
		return out, nil
	}
	for _, el := range walkElements(root) {
		if elLocalName(el.Tag) != "resource" {
			continue
		}
		href := strings.TrimSpace(el.SelectAttrValue("href", ""))
		if href == "" {
			continue
		}
		typ := el.SelectAttr("type")
		var t *string
		if typ != nil {
			t = &typ.Value
		}
		if !isQtiResource(t, href) {
			continue
		}
		p := filepath.Join(extractRoot, filepath.FromSlash(href))
		out = append(out, p)
	}
	return out, nil
}

// DiscoverXMLFiles walks a directory tree, skipping __MACOSX and dotfiles; sorted unique paths.
func DiscoverXMLFiles(root string) ([]string, error) {
	var out []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := d.Name()
		if d.IsDir() {
			if name == "__MACOSX" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasPrefix(name, ".") {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(path), ".xml") {
			return nil
		}
		out = append(out, path)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(out)
	// dedupe
	w := 0
	var prev string
	for _, p := range out {
		if w == 0 || p != prev {
			out[w] = p
			w++
			prev = p
		}
	}
	return out[:w], nil
}

func elLocalName(tag string) string {
	if i := strings.LastIndex(tag, "}"); i >= 0 {
		return tag[i+1:]
	}
	return tag
}

func isQtiResource(resType *string, href string) bool {
	hrefL := strings.ToLower(href)
	t := strings.ToLower(stringOrEmpty(resType))
	if strings.Contains(t, "imsqti") || strings.Contains(t, "qti") {
		return strings.HasSuffix(hrefL, ".xml") || strings.HasSuffix(hrefL, ".qti")
	}
	return strings.HasSuffix(hrefL, ".xml") && (strings.Contains(hrefL, "assessment") || strings.Contains(hrefL, "item"))
}

func stringOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func walkElements(e *etree.Element) []*etree.Element {
	var out []*etree.Element
	var walk func(*etree.Element)
	walk = func(x *etree.Element) {
		if x == nil {
			return
		}
		out = append(out, x)
		for _, ch := range x.ChildElements() {
			walk(ch)
		}
	}
	walk(e)
	return out
}

// ReadManifestFile is a small helper for local cc imports (optional; keeps parity with Rust when reading from disk).
func ReadManifestFile(extractRoot string) (string, error) {
	b, err := os.ReadFile(filepath.Join(extractRoot, "imsmanifest.xml"))
	if err != nil {
		return "", err
	}
	return string(b), nil
}
