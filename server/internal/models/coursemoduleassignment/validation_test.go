package coursemoduleassignment

import (
	"strings"
	"testing"
	"time"
)

func sptr(s string) *string { return &s }

func TestValidateAssignmentDeliverySettings(t *testing.T) {
	now := time.Now()
	earlier := now.Add(-time.Hour)
	later := now.Add(time.Hour)

	cases := []struct {
		name          string
		from, until   *time.Time
		code          *string
		text, file, url bool
		wantErr       bool
	}{
		{"all nil + text only", nil, nil, nil, true, false, false, false},
		{"file only", nil, nil, nil, false, true, false, false},
		{"url only", nil, nil, nil, false, false, true, false},
		{"no submission types", nil, nil, nil, false, false, false, true},
		{"from after until", &later, &earlier, nil, true, false, false, true},
		{"from equal until", &now, &now, nil, true, false, false, false},
		{"from before until", &earlier, &later, nil, true, false, false, false},
		{"only from", &earlier, nil, nil, true, false, false, false},
		{"only until", nil, &later, nil, true, false, false, false},
		{"code ok", nil, nil, sptr("abc"), true, false, false, false},
		{"code empty", nil, nil, sptr(""), true, false, false, false},
		{"code too long", nil, nil, sptr(strings.Repeat("a", 129)), true, false, false, true},
		{"code at limit", nil, nil, sptr(strings.Repeat("a", 128)), true, false, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateAssignmentDeliverySettings(c.from, c.until, c.code, c.text, c.file, c.url)
			if (err != nil) != c.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, c.wantErr)
			}
		})
	}
}

func TestValidateAssignmentLateSettings(t *testing.T) {
	if err := ValidateAssignmentLateSettings("allow", nil); err != nil {
		t.Fatal(err)
	}
	if err := ValidateAssignmentLateSettings("penalty", nil); err == nil {
		t.Fatal("expected error")
	}
}
