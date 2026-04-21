//! Quiz submit and enrollment authorization paths against a real Postgres database.
//! Run with the same env as `http_acceptance` (`DATABASE_URL`, `JWT_SECRET`, `RUN_MIGRATIONS`).

use serde_json::{json, Value};
use uuid::Uuid;

async fn json_body(res: reqwest::Response) -> Value {
    let t = res.text().await.unwrap_or_default();
    if t.is_empty() {
        return json!({});
    }
    serde_json::from_str(&t).unwrap_or_else(|_| json!({}))
}

#[tokio::test]
async fn module_quiz_submit_round_trip() {
    std::env::set_var("RUN_MIGRATIONS", "true");
    if std::env::var("JWT_SECRET").is_err() {
        std::env::set_var(
            "JWT_SECRET",
            "integration-test-jwt-secret-32chars-minimum-x",
        );
    }
    study_drift_server::load_dotenv();
    if std::env::var("DATABASE_URL").is_err() {
        std::env::set_var(
            "DATABASE_URL",
            "postgres://studydrift:studydrift@127.0.0.1:5432/studydrift",
        );
    }

    let state = study_drift_server::build_app_state_from_env()
        .await
        .expect("build app state");
    let pool = &state.pool;
    for sql in [
        r#"INSERT INTO "user".permissions (permission_string, description) VALUES ('global:app:course:create', 'Integration test') ON CONFLICT (permission_string) DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:course:create' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:reports:view' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:rbac:manage' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
    ] {
        sqlx::query(sql).execute(pool).await.expect(sql);
    }

    let app = study_drift_server::app::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let base = format!("http://{}", addr);
    let client = reqwest::Client::new();

    let suf = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let email = format!("quizsubmit{suf}@example.com");
    let signup_body = json!({
        "email": email,
        "password": "password123",
        "display_name": "Quiz Submit User"
    });
    let r = client
        .post(format!("{base}/api/v1/auth/signup"))
        .json(&signup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let body = json_body(r).await;
    let token = body["access_token"].as_str().expect("access token");

    let r = client
        .post(format!("{base}/api/v1/courses"))
        .bearer_auth(token)
        .json(&json!({ "title": "Quiz Submit Course", "description": "Q" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let course = json_body(r).await;
    let course_code = course["courseCode"].as_str().unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Week 1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let mod_res = json_body(r).await;
    let module_id = mod_res["id"].as_str().unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/quizzes"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "MC Quiz" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let quiz_item = json_body(r).await;
    let item_id = quiz_item["id"].as_str().unwrap();

    let qid = format!("q-int-{suf}");
    let r = client
        .patch(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}"
        ))
        .bearer_auth(token)
        .json(&json!({
            "questions": [{
                "id": qid,
                "prompt": "Choose A",
                "questionType": "multiple_choice",
                "choices": ["Alpha", "Beta", "Gamma"],
                "correctChoiceIndex": 0,
                "points": 1
            }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}/start"
        ))
        .bearer_auth(token)
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let start = json_body(r).await;
    let attempt_id = start["attemptId"].as_str().unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}/submit"
        ))
        .bearer_auth(token)
        .json(&json!({
            "attemptId": attempt_id,
            "responses": [{
                "questionId": qid,
                "selectedChoiceIndex": 0
            }]
        }))
        .send()
        .await
        .unwrap();
    let submit_status = r.status();
    let submit_err = r.text().await.unwrap_or_default();
    assert_eq!(
        submit_status,
        reqwest::StatusCode::OK,
        "submit failed: {submit_err}"
    );
    let sub: Value = serde_json::from_str(&submit_err).unwrap_or(json!({}));
    assert_eq!(sub["attemptId"].as_str().unwrap(), attempt_id);
    assert!(sub["scorePercent"].as_f64().unwrap_or(-1.0) >= 0.0);
}

#[tokio::test]
async fn add_enrollments_forbidden_for_student_only_member() {
    std::env::set_var("RUN_MIGRATIONS", "true");
    if std::env::var("JWT_SECRET").is_err() {
        std::env::set_var(
            "JWT_SECRET",
            "integration-test-jwt-secret-32chars-minimum-x",
        );
    }
    study_drift_server::load_dotenv();
    if std::env::var("DATABASE_URL").is_err() {
        std::env::set_var(
            "DATABASE_URL",
            "postgres://studydrift:studydrift@127.0.0.1:5432/studydrift",
        );
    }

    let state = study_drift_server::build_app_state_from_env()
        .await
        .expect("build app state");
    let pool = &state.pool;
    for sql in [
        r#"INSERT INTO "user".permissions (permission_string, description) VALUES ('global:app:course:create', 'Integration test') ON CONFLICT (permission_string) DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:course:create' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:reports:view' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:rbac:manage' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
    ] {
        sqlx::query(sql).execute(pool).await.expect(sql);
    }

    let app = study_drift_server::app::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let base = format!("http://{}", addr);
    let client = reqwest::Client::new();

    let suf = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();

    let email_a = format!("staff{suf}@example.com");
    let r = client
        .post(format!("{base}/api/v1/auth/signup"))
        .json(&json!({
            "email": email_a,
            "password": "password123",
            "display_name": "Staff"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let body = json_body(r).await;
    let token_a = body["access_token"].as_str().unwrap();

    let r = client
        .post(format!("{base}/api/v1/courses"))
        .bearer_auth(token_a)
        .json(&json!({ "title": "Roster Course", "description": "R" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let course = json_body(r).await;
    let course_code = course["courseCode"].as_str().unwrap();
    let course_id: Uuid = course["id"].as_str().unwrap().parse().unwrap();

    let email_b = format!("learner{suf}@example.com");
    let r = client
        .post(format!("{base}/api/v1/auth/signup"))
        .json(&json!({
            "email": email_b,
            "password": "password123",
            "display_name": "Learner"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let body_b = json_body(r).await;
    let user_b: Uuid = body_b["user"]["id"].as_str().unwrap().parse().unwrap();

    let state_enroll = study_drift_server::build_app_state_from_env()
        .await
        .expect("build app state for enrollment insert");
    sqlx::query(
        r#"INSERT INTO course.course_enrollments (course_id, user_id, role)
           VALUES ($1, $2, 'student')
           ON CONFLICT (course_id, user_id, role) DO NOTHING"#,
    )
    .bind(course_id)
    .bind(user_b)
    .execute(&state_enroll.pool)
    .await
    .expect("insert student enrollment");

    let r = client
        .post(format!("{base}/api/v1/auth/login"))
        .json(&json!({
            "email": email_b,
            "password": "password123"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let login_b = json_body(r).await;
    let token_b = login_b["access_token"].as_str().unwrap();

    let r = client
        .post(format!("{base}/api/v1/courses/{course_code}/enrollments"))
        .bearer_auth(token_b)
        .json(&json!({ "emails": "someone@example.com" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::FORBIDDEN);
    let err = json_body(r).await;
    assert_eq!(err["error"]["code"], "FORBIDDEN");
}

#[tokio::test]
async fn learner_mastery_tracks_tagged_quiz_question() {
    std::env::set_var("RUN_MIGRATIONS", "true");
    std::env::set_var("ADAPTIVE_LEARNER_MODEL_ENABLED", "true");
    if std::env::var("JWT_SECRET").is_err() {
        std::env::set_var(
            "JWT_SECRET",
            "integration-test-jwt-secret-32chars-minimum-x",
        );
    }
    study_drift_server::load_dotenv();
    if std::env::var("DATABASE_URL").is_err() {
        std::env::set_var(
            "DATABASE_URL",
            "postgres://studydrift:studydrift@127.0.0.1:5432/studydrift",
        );
    }

    let state = study_drift_server::build_app_state_from_env()
        .await
        .expect("build app state");
    let pool = &state.pool;
    for sql in [
        r#"INSERT INTO "user".permissions (permission_string, description) VALUES ('global:app:course:create', 'Integration test') ON CONFLICT (permission_string) DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:course:create' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:reports:view' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:rbac:manage' WHERE r.name = 'Teacher' ON CONFLICT DO NOTHING"#,
    ] {
        sqlx::query(sql).execute(pool).await.expect(sql);
    }

    let app = study_drift_server::app::router(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let base = format!("http://{}", addr);
    let client = reqwest::Client::new();

    let suf = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let email = format!("learnermaster{suf}@example.com");
    let r = client
        .post(format!("{base}/api/v1/auth/signup"))
        .json(&json!({
            "email": email,
            "password": "password123",
            "display_name": "Mastery User"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let body = json_body(r).await;
    let token = body["access_token"].as_str().expect("access token");
    let user_id: Uuid = body["user"]["id"].as_str().unwrap().parse().unwrap();

    let r = client
        .post(format!("{base}/api/v1/courses"))
        .bearer_auth(token)
        .json(&json!({ "title": "Mastery Course", "description": "M" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let course = json_body(r).await;
    let course_code = course["courseCode"].as_str().unwrap();
    let course_id: Uuid = course["id"].as_str().unwrap().parse().unwrap();

    let concept_id = Uuid::new_v4();
    let concept_slug = format!("linear-eq-{suf}");
    sqlx::query(
        r#"INSERT INTO course.concepts (id, course_id, name, slug)
           VALUES ($1, $2, 'Linear equations', $3)"#,
    )
    .bind(concept_id)
    .bind(course_id)
    .bind(&concept_slug)
    .execute(pool)
    .await
    .expect("insert concept");

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Mod A" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let mod_res = json_body(r).await;
    let module_id = mod_res["id"].as_str().unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/quizzes"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Tagged Quiz" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let quiz_item = json_body(r).await;
    let item_id = quiz_item["id"].as_str().unwrap();

    let qid = format!("q-m-{suf}");
    let r = client
        .patch(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}"
        ))
        .bearer_auth(token)
        .json(&json!({
            "questions": [{
                "id": qid,
                "prompt": "Pick A",
                "questionType": "multiple_choice",
                "choices": ["A", "B", "C"],
                "correctChoiceIndex": 0,
                "points": 1,
                "conceptIds": [ concept_id.to_string() ]
            }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}/start"
        ))
        .bearer_auth(token)
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let start = json_body(r).await;
    let attempt_id = start["attemptId"].as_str().unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{item_id}/submit"
        ))
        .bearer_auth(token)
        .json(&json!({
            "attemptId": attempt_id,
            "responses": [{
                "questionId": qid,
                "selectedChoiceIndex": 0
            }]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .get(format!("{base}/api/v1/learners/{user_id}/concepts"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let mastery_body = json_body(r).await;
    let concepts = mastery_body["concepts"].as_array().expect("concepts array");
    assert_eq!(concepts.len(), 1);
    assert_eq!(
        concepts[0]["conceptId"].as_str().unwrap(),
        concept_id.to_string()
    );
    assert!(concepts[0]["mastery"].as_f64().unwrap_or(0.0) > 0.0);

    let r = client
        .get(format!(
            "{base}/api/v1/learners/{user_id}/concepts/{concept_id}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
}
