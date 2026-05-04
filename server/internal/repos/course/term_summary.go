package course

// TermSummary is embedded course term metadata (plan 5.3).
type TermSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	TermType  string `json:"termType"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Status    string `json:"status"`
}
