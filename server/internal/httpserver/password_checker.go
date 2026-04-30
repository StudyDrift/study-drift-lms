package httpserver

import "github.com/lextures/lextures/server/internal/auth/hibp"

func (d Deps) passwordChecker() hibp.Checker {
	if d.PasswordChecker != nil {
		return d.PasswordChecker
	}
	if d.Pool == nil {
		return hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	}
	return hibp.AsChecker(hibp.NewService(d.Pool))
}
