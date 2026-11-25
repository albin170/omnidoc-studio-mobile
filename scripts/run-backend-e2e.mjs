import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_BACKEND_DIR = 'c:\\Users\\Dell\\Documents\\omnidoc-studio\\backend';
const UVICORN_EXE = path.join(ORIGINAL_BACKEND_DIR, '.venv', 'Scripts', 'uvicorn.exe');
const PYTHON_EXE = path.join(ORIGINAL_BACKEND_DIR, '.venv', 'Scripts', 'python.exe');

const PORT = 18089;
const BASE_URL = `http://127.0.0.1:${PORT}/api/v1`;
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omnidoc-mobile-e2e-'));
const TEMP_DB_PATH = path.join(TEMP_DIR, 'e2e.db');
const TEMP_VAULT_DIR = path.join(TEMP_DIR, 'vault');
fs.mkdirSync(TEMP_VAULT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(pathSuffix, options = {}) {
  const res = await fetch(`${BASE_URL}${pathSuffix}`, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, data: json, raw: text };
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error('Backend E2E server failed to become healthy within timeout');
}

const server = spawn(
  UVICORN_EXE,
  ['app.main:app', '--host', '127.0.0.1', '--port', String(PORT)],
  {
    cwd: ORIGINAL_BACKEND_DIR,
    env: {
      ...process.env,
      ENVIRONMENT: 'development',
      DATABASE_URL: `sqlite+aiosqlite:///${TEMP_DB_PATH.replace(/\\/g, '/')}`,
      STORAGE_PROVIDER: 'local',
      STORAGE_DIR: TEMP_VAULT_DIR,
      SECRET_KEY: 'omnidoc_mobile_e2e_test_secret_key_with_high_entropy_2026',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let serverLogs = '';
server.stdout.on('data', (d) => {
  serverLogs += d.toString();
});
server.stderr.on('data', (d) => {
  serverLogs += d.toString();
});

try {
  console.log('[E2E] Waiting for unmodified OmniDoc Studio FastAPI backend on port', PORT);
  await waitForHealth();
  console.log('[E2E] Health OK');

  const email = `mobile_e2e_${Date.now()}@example.com`;
  const password = 'MobileE2ePassword123!';
  const newPassword = 'MobileE2ePassword456!';

  // 1. Register
  const reg = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      full_name: 'Mobile E2E User',
      organization_name: 'Mobile E2E Org',
      terms_accepted: true,
      terms_version: '2026.1',
      privacy_accepted: true,
      privacy_version: '2026.1',
      ai_consent: true,
      ai_consent_version: '2026.1',
      marketing_consent: false,
    }),
  });
  assert.equal(reg.status, 201, `Register failed: ${reg.raw}`);
  console.log('[E2E] 1. Register passed');

  // 2. Login
  const loginRes = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, `Login failed: ${loginRes.raw}`);
  let token = loginRes.data.access_token;
  assert.ok(token);
  console.log('[E2E] 2. Login passed');

  // 3. Profile / Auth Me / Usage / Entitlements
  const meRes = await api('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.email, email);
  const usageRes = await api('/users/me/usage', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(usageRes.status, 200);
  const entRes = await api('/users/me/entitlements', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(entRes.status, 200);
  console.log('[E2E] 3. Profile, usage & entitlements passed');

  // 4. Document Upload + List + Download byte-for-byte
  const samplePdfBytes = Buffer.from(
    '%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF'
  );
  const form = new FormData();
  form.append('file', new Blob([samplePdfBytes], { type: 'application/pdf' }), 'mobile_test.pdf');
  const uploadRes = await fetch(`${BASE_URL}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(uploadRes.status, 201, `Upload failed: ${await uploadRes.clone().text()}`);
  const uploadedDoc = await uploadRes.json();
  assert.ok(uploadedDoc.id);

  const listDocs = await api('/documents', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(listDocs.status, 200);
  assert.ok(listDocs.data.some((d) => d.id === uploadedDoc.id));

  const dlRes = await fetch(`${BASE_URL}/documents/${uploadedDoc.id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(dlRes.status, 200);
  const dlBuf = Buffer.from(await dlRes.arrayBuffer());
  assert.deepEqual(dlBuf, samplePdfBytes);
  console.log('[E2E] 4. Upload, list & download integrity passed');

  // 5. Submit Job + History
  const jobRes = await api('/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Mobile E2E Inspection',
      objective: 'inspect and parse document',
      document_ids: [uploadedDoc.id],
      mode: 'hybrid',
    }),
  });
  assert.equal(jobRes.status, 201, `Job submit failed: ${jobRes.raw}`);
  const jobsList = await api('/jobs', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(jobsList.status, 200);
  assert.ok(jobsList.data.length >= 1);
  console.log('[E2E] 5. Jobs & processing history passed');

  // 6. Cloud Project Sync (Sheets)
  const projRes = await api('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Mobile Sheet Sync',
      project_type: 'sheets',
      data: { sheetNames: ['Sheet1'], sheets: { Sheet1: [['A', 'B'], [1, 2]] } },
    }),
  });
  assert.equal(projRes.status, 201, `Project create failed: ${projRes.raw}`);
  console.log('[E2E] 6. Cloud project sync passed');

  // 7. Notifications & Preferences
  const notifRes = await api('/notifications', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(notifRes.status, 200);
  const prefRes = await api('/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ in_app_workflow: true }),
  });
  assert.equal(prefRes.status, 200);
  console.log('[E2E] 7. Notifications & preferences passed');

  // 8. Standard User RBAC check against Admin Route -> 403
  const forbiddenAdmin = await api('/admin/telemetry', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(forbiddenAdmin.status, 403);
  console.log('[E2E] 8. Standard user blocked from /admin/telemetry (403) passed');

  // 9. Password change & token rotation
  const pwRes = await api('/users/me/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: password, new_password: newPassword }),
  });
  assert.equal(pwRes.status, 200);
  const rotatedToken = pwRes.data.access_token;
  assert.ok(rotatedToken);
  const oldTokenCheck = await api('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(oldTokenCheck.status, 401);
  const newTokenCheck = await api('/auth/me', { headers: { Authorization: `Bearer ${rotatedToken}` } });
  assert.equal(newTokenCheck.status, 200);
  token = rotatedToken;
  console.log('[E2E] 9. Password change & old token revocation passed');

  // 10. Promote user to admin in temp SQLite DB & verify Admin Portal Login + Telemetry
  execFileSync(PYTHON_EXE, [
    '-c',
    `import sqlite3; c=sqlite3.connect(r"${TEMP_DB_PATH}"); c.execute("UPDATE users SET role='admin' WHERE email=?", ("${email}",)); c.commit(); c.close()`,
  ]);
  const adminLogin = await api('/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: newPassword }),
  });
  assert.equal(adminLogin.status, 200, `Admin login failed: ${adminLogin.raw}`);
  const adminToken = adminLogin.data.access_token;
  const telemetry = await api('/admin/telemetry', { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(telemetry.status, 200);
  assert.ok(telemetry.data.total_users >= 1);
  console.log('[E2E] 10. Admin login & telemetry passed');

  // 11. Logout & Token Revocation
  const logoutRes = await api('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(logoutRes.status, 200);
  const afterLogout = await api('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(afterLogout.status, 401);
  console.log('[E2E] 11. Logout & token revocation (401) passed');

  console.log('\nALL 11 REAL BACKEND E2E CHECKS PASSED!');
} catch (err) {
  console.error('[E2E] FAILED:', err);
  console.error('--- SERVER LOGS ---\n', serverLogs);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
