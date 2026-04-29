package srs

import "strings"

// SM-2 scheduling (parity with server/src/services/srs_scheduler.rs).

type Sm2State struct {
	EasinessFactor float64
	Repetition     int32
	IntervalDays   float64
}

func DefaultSm2State() Sm2State {
	return Sm2State{EasinessFactor: 2.5, Repetition: 0, IntervalDays: 0}
}

func GradeToQuality(grade string) (float64, bool) {
	switch strings.ToLower(strings.TrimSpace(grade)) {
	case "again":
		return 0, true
	case "hard":
		return 2, true
	case "good":
		return 4, true
	case "easy":
		return 5, true
	default:
		return 0, false
	}
}

func Sm2Step(prev Sm2State, quality float64) Sm2State {
	q := quality
	if q < 0 {
		q = 0
	}
	if q > 5 {
		q = 5
	}
	ef := prev.EasinessFactor
	if ef < 1.3 {
		ef = 1.3
	}
	repetition := prev.Repetition

	if q < 3.0 {
		return Sm2State{
			EasinessFactor: ef,
			Repetition:     0,
			IntervalDays:   1,
		}
	}

	efDelta := 0.1 - (5.0-q)*(0.08+(5.0-q)*0.02)
	ef = ef + efDelta
	if ef < 1.3 {
		ef = 1.3
	}

	var interval float64
	if repetition == 0 {
		interval = 1
	} else if repetition == 1 {
		interval = 6
	} else {
		interval = prev.IntervalDays * ef
		if interval < 1 {
			interval = 1
		}
		interval = float64(int64(interval + 0.5))
	}
	repetition++

	return Sm2State{
		EasinessFactor: ef,
		Repetition:     repetition,
		IntervalDays:   interval,
	}
}
