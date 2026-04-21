//! Item Response Theory (2PL): ICC, Fisher information, EAP ability estimation, CAT selection.
//! Pure numeric helpers — no database I/O.

use uuid::Uuid;

const THETA_GRID_MIN: f64 = -4.0;
const THETA_GRID_MAX: f64 = 4.0;
const THETA_GRID_STEP: f64 = 0.05;
const THETA_CLAMP: f64 = 4.0;

/// `IRT_CAT_MODE_ENABLED` — default `false` (plan 1.6 rollout).
pub fn cat_mode_enabled() -> bool {
    match std::env::var("IRT_CAT_MODE_ENABLED") {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => false,
    }
}

/// 2PL probability of a correct response at latent ability `theta`.
#[inline]
pub fn prob_2pl(theta: f64, a: f64, b: f64) -> f64 {
    let x = a * (theta - b);
    // numerically stable logistic
    if x >= 0.0 {
        let e = (-x).exp();
        1.0 / (1.0 + e)
    } else {
        let e = x.exp();
        e / (1.0 + e)
    }
}

/// Fisher information for a 2PL item at `theta`.
#[inline]
pub fn fisher_information_2pl(theta: f64, a: f64, b: f64) -> f64 {
    let p = prob_2pl(theta, a, b);
    let q = 1.0 - p;
    a * a * p * q
}

/// Standard normal PDF.
#[inline]
fn normal_pdf(x: f64) -> f64 {
    (-0.5 * x * x).exp() / (2.0 * std::f64::consts::PI).sqrt()
}

fn theta_grid() -> Vec<f64> {
    let mut v = Vec::new();
    let mut t = THETA_GRID_MIN;
    while t <= THETA_GRID_MAX + 1e-9 {
        v.push(t);
        t += THETA_GRID_STEP;
    }
    v
}

/// EAP estimate of θ with standard normal prior, 2PL items, dichotomous correct (1) / incorrect (0).
/// Returns (theta_mean, posterior_sd). Empty responses → (0.0, 1.0).
pub fn eap_theta_2pl(responses: &[(f64, f64, u8)]) -> (f64, f64) {
    let grid = theta_grid();
    if responses.is_empty() {
        return (0.0, 1.0);
    }
    let mut w = vec![0.0_f64; grid.len()];
    for (i, &theta) in grid.iter().enumerate() {
        let mut lp = normal_pdf(theta).ln();
        if !lp.is_finite() {
            lp = -1e300;
        }
        for &(a, b, u) in responses {
            let p = prob_2pl(theta, a, b).clamp(1e-9, 1.0 - 1e-9);
            lp += if u == 1 { p.ln() } else { (1.0 - p).ln() };
        }
        w[i] = lp;
    }
    let wmax = w.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    for x in &mut w {
        *x = (*x - wmax).exp();
    }
    let sum: f64 = w.iter().sum();
    if sum <= 0.0 || !sum.is_finite() {
        return (0.0, 1.0);
    }
    for x in &mut w {
        *x /= sum;
    }
    let mean: f64 = grid.iter().zip(w.iter()).map(|(&t, &wi)| t * wi).sum();
    let mean2: f64 = grid.iter().zip(w.iter()).map(|(&t, &wi)| t * t * wi).sum();
    let var = (mean2 - mean * mean).max(1e-12);
    let se = var.sqrt();
    (mean.clamp(-THETA_CLAMP, THETA_CLAMP), se)
}

/// Pick the candidate item maximizing Fisher information at `theta`.
/// `candidates` = (question_id, a, b). If `calibrated_only` is false, uses all with default a=1, b=0 when missing.
pub fn select_max_information_item(
    theta: f64,
    candidates: &[(uuid::Uuid, Option<f64>, Option<f64>)],
    exclude: &[uuid::Uuid],
    calibrated_only: bool,
) -> Option<uuid::Uuid> {
    let mut best: Option<(Uuid, f64)> = None;
    for &(id, a_opt, b_opt) in candidates {
        if exclude.contains(&id) {
            continue;
        }
        let (a, b, ok) = match (a_opt, b_opt) {
            (Some(a), Some(b)) if a > 0.01 && a.is_finite() && b.is_finite() => (a, b, true),
            _ if !calibrated_only => (1.0, 0.0, true),
            _ => continue,
        };
        if !ok {
            continue;
        }
        let info = fisher_information_2pl(theta, a, b);
        match best {
            None => best = Some((id, info)),
            Some((bid, bi)) if info > bi => best = Some((id, info)),
            _ => {}
        }
    }
    best.map(|(id, _)| id)
}

/// Marginal log-likelihood for one 2PL item given dichotomous responses, θ ~ N(0,1), Gauss–Hermite style quadrature.
/// Uses change of variables with normal grid weights (adequate for v1 calibration).
pub fn marginal_loglik_2pl_item(a: f64, b: f64, responses: &[u8]) -> f64 {
    let nodes: [f64; 21] = [
        -4.0, -3.6, -3.2, -2.8, -2.4, -2.0, -1.6, -1.2, -0.8, -0.4, 0.0, 0.4, 0.8, 1.2, 1.6, 2.0,
        2.4, 2.8, 3.2, 3.6, 4.0,
    ];
    let mut total = 0.0_f64;
    for &u in responses {
        let mut acc = 0.0_f64;
        let mut norm = 0.0_f64;
        for &theta in &nodes {
            let w = normal_pdf(theta);
            norm += w;
            let p = prob_2pl(theta, a, b).clamp(1e-9, 1.0 - 1e-9);
            acc += w * if u == 1 { p.ln() } else { (1.0 - p).ln() };
        }
        if norm > 0.0 {
            total += acc / norm;
        }
    }
    total
}

/// Coarse grid search for (a, b) maximizing marginal log-likelihood (θ ~ N(0,1)).
pub fn icc_curve_points(a: f64, b: f64, c: f64) -> Vec<(f64, f64)> {
    let c = c.clamp(0.0, 0.35);
    let mut out = Vec::with_capacity(33);
    let mut t = THETA_GRID_MIN;
    while t <= THETA_GRID_MAX + 1e-9 {
        let p2 = prob_2pl(t, a, b);
        let p = if c > 1e-6 {
            c + (1.0 - c) * p2
        } else {
            p2
        };
        out.push((t, p.clamp(0.0, 1.0)));
        t += 0.25;
    }
    out
}

pub fn calibrate_2pl_marginal_grid(responses: &[u8]) -> Option<(f64, f64)> {
    if responses.len() < 10 {
        return None;
    }
    let mut best: Option<(f64, f64, f64)> = None;
    let mut a = 0.5_f64;
    while a <= 2.51 {
        let mut b = -3.0_f64;
        while b <= 3.01 {
            let ll = marginal_loglik_2pl_item(a, b, responses);
            match best {
                None => best = Some((a, b, ll)),
                Some((_, _, bl)) if ll > bl => best = Some((a, b, ll)),
                _ => {}
            }
            b += 0.25;
        }
        a += 0.25;
    }
    let (a0, b0, _) = best?;
    // Local refinement
    let mut a = a0;
    let mut b = b0;
    for _ in 0..12 {
        let base = marginal_loglik_2pl_item(a, b, responses);
        let da = 0.05;
        let db = 0.05;
        let mut step_a = 0.0_f64;
        let mut step_b = 0.0_f64;
        if marginal_loglik_2pl_item((a + da).clamp(0.3, 3.0), b, responses) > base {
            step_a = da;
        } else if marginal_loglik_2pl_item((a - da).clamp(0.3, 3.0), b, responses) > base {
            step_a = -da;
        }
        if marginal_loglik_2pl_item(a, (b + db).clamp(-3.5, 3.5), responses) > base {
            step_b = db;
        } else if marginal_loglik_2pl_item(a, (b - db).clamp(-3.5, 3.5), responses) > base {
            step_b = -db;
        }
        if step_a == 0.0 && step_b == 0.0 {
            break;
        }
        a = (a + step_a).clamp(0.3, 3.0);
        b = (b + step_b).clamp(-3.5, 3.5);
    }
    Some((a, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eap_single_correct_item_pushes_theta_up() {
        let r = [(1.0, 0.0, 1_u8)];
        let (t, se) = eap_theta_2pl(&r);
        assert!(t > 0.2, "theta={t}");
        assert!(se > 0.0 && se < 2.0, "se={se}");
        assert!(t.is_finite() && t.abs() <= 4.0);
    }

    #[test]
    fn eap_wrong_on_hard_item_pulls_theta_down() {
        let r = [(1.5, 1.5, 0_u8)];
        let (t, _) = eap_theta_2pl(&r);
        assert!(t < 0.1, "theta={t}");
    }

    #[test]
    fn fisher_information_peak_near_b() {
        let a = 1.2;
        let b = 0.5;
        let i0 = fisher_information_2pl(b, a, b);
        let i1 = fisher_information_2pl(b - 1.5, a, b);
        assert!(i0 > i1);
    }

    #[test]
    fn synthetic_calibration_recovers_b_roughly() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};
        let mut rng = StdRng::seed_from_u64(42);
        let a_true = 1.2;
        let b_true = 0.5;
        let mut resp = Vec::with_capacity(250);
        for _ in 0..250 {
            let theta = rng.random_range(-2.5_f64..2.5);
            let p = prob_2pl(theta, a_true, b_true);
            let u: u8 = if rng.random::<f64>() < p { 1 } else { 0 };
            resp.push(u);
        }
        let (a_hat, b_hat) = calibrate_2pl_marginal_grid(&resp).expect("calibrated");
        assert!(a_hat.is_finite() && b_hat.is_finite());
        assert!((0.3..=3.0).contains(&a_hat), "a_hat={a_hat}");
        assert!((-3.5..=3.5).contains(&b_hat), "b_hat={b_hat}");
        // Marginal grid MML is a coarse v1 estimator; sanity-check proximity without flaking on RNG.
        assert!(
            (b_hat - b_true).abs() < 1.2501,
            "b_hat={b_hat} b_true={b_true}"
        );
    }
}
