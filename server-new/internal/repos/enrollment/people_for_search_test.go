package enrollment

import "testing"

func TestDisplayRoleForSearch(t *testing.T) {
	for _, x := range []struct {
		in, want string
	}{
		{"teacher", "Teacher"},
		{"instructor", "Instructor"},
		{"student", "Student"},
		{"ta", "Student"},
	} {
		if g := displayRoleForSearch(x.in); g != x.want {
			t.Errorf("%q: got %q", x.in, g)
		}
	}
}
