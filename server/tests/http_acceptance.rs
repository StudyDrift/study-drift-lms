//! End-to-end HTTP tests against a real Postgres database.
//!
//! Set `DATABASE_URL` (for example `postgres://studydrift:studydrift@127.0.0.1:5432/studydrift` when
//! using `docker compose up postgres`). `JWT_SECRET` is set if unset.

use serde_json::{json, Value};
use std::net::SocketAddr;

async fn json_body(res: reqwest::Response) -> Value {
    let t = res.text().await.unwrap_or_default();
    if t.is_empty() {
        return json!({});
    }
    serde_json::from_str(&t).unwrap_or_else(|_| json!({}))
}

#[tokio::test]
async fn full_http_walkthrough() {
    std::env::set_var("RUN_MIGRATIONS", "true");
    if std::env::var("JWT_SECRET").is_err() {
        std::env::set_var("JWT_SECRET", "integration-test-jwt-secret");
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
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:course:create' WHERE r.name = 'Student' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:reports:view' WHERE r.name = 'Student' ON CONFLICT DO NOTHING"#,
        r#"INSERT INTO "user".rbac_role_permissions (role_id, permission_id) SELECT r.id, p.id FROM "user".app_roles r JOIN "user".permissions p ON p.permission_string = 'global:app:rbac:manage' WHERE r.name = 'Student' ON CONFLICT DO NOTHING"#,
    ] {
        sqlx::query(sql).execute(pool).await.expect(sql);
    }

    let app = study_drift_server::app::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr: SocketAddr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve");
    });
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let base = format!("http://{}", addr);
    let client = reqwest::Client::new();

    let r = client.get(format!("{base}/health")).send().await.unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client.get(format!("{base}/health/ready")).send().await.unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let suf = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let email = format!("integration{suf}@example.com");
    let signup_body = json!({
        "email": email,
        "password": "password123",
        "display_name": "Integration User"
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
        .post(format!("{base}/api/v1/auth/login"))
        .json(&json!({
            "email": email,
            "password": "wrong-password"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::UNAUTHORIZED);

    let r = client
        .get(format!("{base}/api/v1/me/permissions"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let perms = json_body(r).await;
    assert!(perms["permissionStrings"].as_array().is_some());

    let r = client
        .get(format!("{base}/api/v1/search"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let search = json_body(r).await;
    assert!(search["courses"].is_array());

    let r = client
        .get(format!(
            "{base}/api/v1/communication/messages?folder=inbox"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let comm = json_body(r).await;
    assert!(comm["messages"].is_array());

    let r = client
        .get(format!("{base}/api/v1/communication/unread-count"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let unread = json_body(r).await;
    assert!(unread["unread_inbox"].is_number());

    let r = client
        .get(format!("{base}/api/v1/settings/account"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let account = json_body(r).await;
    assert!(account["email"].is_string());

    let r = client
        .get(format!("{base}/api/v1/settings/ai"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let ai = json_body(r).await;
    assert!(
        ai.get("imageModelId").is_some() || ai.get("courseSetupModelId").is_some(),
        "ai settings: {ai:?}"
    );

    let r = client
        .get(format!("{base}/api/v1/settings/permissions"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let rbac_perms = json_body(r).await;
    assert!(rbac_perms["permissions"].is_array());

    let r = client
        .get(format!("{base}/api/v1/settings/roles"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let roles = json_body(r).await;
    assert!(roles["roles"].is_array());

    let perm_str = format!(
        "global:int:{}:perm",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let r = client
        .post(format!("{base}/api/v1/settings/permissions"))
        .bearer_auth(token)
        .json(&json!({
            "permissionString": perm_str,
            "description": "Created by http_acceptance test"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!("{base}/api/v1/courses"))
        .bearer_auth(token)
        .json(&json!({ "title": "Integration Course", "description": "Desc" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let course = json_body(r).await;
    let course_code = course["courseCode"].as_str().unwrap();

    let r = client
        .get(format!("{base}/api/v1/courses"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let list = json_body(r).await;
    assert!(list["courses"].as_array().unwrap().len() >= 1);

    let r = client
        .get(format!("{base}/api/v1/courses/{course_code}"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let one = json_body(r).await;
    assert_eq!(one["courseCode"], course_code);

    let r = client
        .get(format!("{base}/api/v1/courses/{course_code}/structure"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let structure = json_body(r).await;
    assert!(structure["items"].is_array());

    let r = client
        .post(format!("{base}/api/v1/communication/messages"))
        .bearer_auth(token)
        .json(&json!({
            "subject": "Hello",
            "body": "Test message body",
            "draft": true
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .get(format!("{base}/api/v1/courses/{course_code}/syllabus"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let syllabus = json_body(r).await;
    assert!(syllabus.get("sections").is_some());

    let r = client
        .get(format!("{base}/api/v1/courses/{course_code}/grading"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .get(format!(
            "{base}/api/v1/courses/{course_code}/course-scoped-roles"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let scoped_roles = json_body(r).await;
    assert!(scoped_roles["roles"].is_array());

    let r = client
        .get(format!(
            "{base}/api/v1/courses/{course_code}/enrollments"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let enroll = json_body(r).await;
    assert!(enroll.get("enrollments").is_some());

    let r = client
        .get(format!("{base}/api/v1/reports/learning-activity"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let report = json_body(r).await;
    assert!(report.get("summary").is_some());

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

    let _ = client
        .patch(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}"
        ))
        .bearer_auth(token)
        .json(&json!({
            "title": "Week 1 Updated",
            "published": true,
            "visibleFrom": null
        }))
        .send()
        .await
        .unwrap();

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/headings"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Intro" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/content-pages"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Reading" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let page = json_body(r).await;
    let page_id = page["id"].as_str().unwrap();

    let r = client
        .get(format!(
            "{base}/api/v1/courses/{course_code}/content-pages/{page_id}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/assignments"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Homework" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let assign = json_body(r).await;
    let assign_id = assign["id"].as_str().unwrap();

    let r = client
        .get(format!(
            "{base}/api/v1/courses/{course_code}/assignments/{assign_id}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/structure/modules/{module_id}/quizzes"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Quiz 1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let quiz = json_body(r).await;
    let quiz_id = quiz["id"].as_str().unwrap();

    let r = client
        .get(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{quiz_id}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .patch(format!(
            "{base}/api/v1/courses/{course_code}/quizzes/{quiz_id}"
        ))
        .bearer_auth(token)
        .json(&json!({ "title": "Renamed quiz" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let quiz_patch = json_body(r).await;
    assert_eq!(quiz_patch["title"], "Renamed quiz");

    let r = client
        .get(format!("{base}/api/v1/courses/{course_code}/structure"))
        .bearer_auth(token)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);
    let st2 = json_body(r).await;
    let items = st2["items"].as_array().unwrap();
    let mut module_uuid: Option<String> = None;
    for it in items {
        if it["kind"] == "module" && it["parentId"].is_null() {
            module_uuid = Some(it["id"].as_str().unwrap().to_string());
            break;
        }
    }
    if let Some(mid) = module_uuid {
        let mut children: Vec<String> = Vec::new();
        for it in items {
            if it["kind"] != "module" {
                if it["parentId"].as_str() == Some(mid.as_str()) {
                    children.push(it["id"].as_str().unwrap().to_string());
                }
            }
        }
        let mut child_map = serde_json::Map::new();
        child_map.insert(mid.clone(), json!(children));
        let r = client
            .post(format!(
                "{base}/api/v1/courses/{course_code}/structure/reorder"
            ))
            .bearer_auth(token)
            .json(&json!({
                "moduleOrder": [mid],
                "childOrderByModule": Value::Object(child_map)
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), reqwest::StatusCode::OK);
    }

    let r = client
        .patch(format!(
            "{base}/api/v1/courses/{course_code}/markdown-theme"
        ))
        .bearer_auth(token)
        .json(&json!({ "preset": "classic", "custom": null }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .put(format!("{base}/api/v1/courses/{course_code}"))
        .bearer_auth(token)
        .json(&json!({
            "title": "Updated Title",
            "description": "Updated",
            "published": false,
            "startsAt": null,
            "endsAt": null,
            "visibleFrom": null,
            "hiddenAt": null
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .put(format!("{base}/api/v1/courses/{course_code}/grading"))
        .bearer_auth(token)
        .json(&json!({
            "gradingScale": "percent",
            "assignmentGroups": []
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .patch(format!("{base}/api/v1/courses/{course_code}/syllabus"))
        .bearer_auth(token)
        .json(&json!({ "sections": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::OK);

    let r = client
        .post(format!(
            "{base}/api/v1/courses/{course_code}/course-context"
        ))
        .bearer_auth(token)
        .json(&json!({ "kind": "course_visit" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), reqwest::StatusCode::NO_CONTENT);
}
