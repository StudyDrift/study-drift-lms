package studentnotebookrag

type StudentNotebookRagRequest struct {
	Question  string                    `json:"question"`
	Notebooks []StudentNotebookDocInput `json:"notebooks"`
}

type StudentNotebookDocInput struct {
	CourseCode  string `json:"courseCode"`
	CourseTitle string `json:"courseTitle"`
	Markdown    string `json:"markdown"`
}

type StudentNotebookRagResponse struct {
	AnswerMarkdown string                     `json:"answerMarkdown"`
	Sources        []StudentNotebookRagSource `json:"sources"`
}

type StudentNotebookRagSource struct {
	CourseCode  string `json:"courseCode"`
	CourseTitle string `json:"courseTitle"`
	Excerpt     string `json:"excerpt"`
}
