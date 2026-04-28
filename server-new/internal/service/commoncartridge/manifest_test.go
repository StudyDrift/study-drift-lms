package commoncartridge

import (
	"path/filepath"
	"testing"
)

func TestQtiXMLPathsFromManifest(t *testing.T) {
	const xml = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <resources>
    <resource identifier="R1" type="imsqti_xmlv1p2" href="items/a.xml"/>
    <resource identifier="R2" type="webcontent" href="skip.html"/>
  </resources>
</manifest>`
	root := t.TempDir()
	paths, err := QtiXMLPathsFromManifest(xml, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 {
		t.Fatalf("paths=%v", paths)
	}
	want := filepath.Join(root, "items", "a.xml")
	if paths[0] != want {
		t.Fatalf("got %q want %q", paths[0], want)
	}
}

func TestIsQtiResourceHeuristic(t *testing.T) {
	h := "folder/Assessment1.xml"
	if !isQtiResource(nil, h) {
		t.Fatal("expected assessment xml heuristic")
	}
}
