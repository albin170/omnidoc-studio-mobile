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

  const ts = Date.now();
  const email = `mobile_e2e_${ts}@example.com`;
  const userBEmail = `mobile_e2e_userb_${ts}@example.com`;
  const password = 'MobileE2ePassword123!';
  const newPassword = 'MobileE2ePassword456!';

  // 1. Register User A
  const reg = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      full_name: 'Mobile E2E User A',
      organization_name: 'Mobile E2E Org A',
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
  console.log('[E2E] 1. Register User A passed');

  // 2. Login User A
  const loginRes = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200, `Login failed: ${loginRes.raw}`);
  let token = loginRes.data.access_token;
  assert.ok(token);
  console.log('[E2E] 2. Login User A passed');

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

  // 5. Cross-User / Cross-Tenant Isolation (User B vs User A's document)
  const regB = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userBEmail,
      password,
      full_name: 'Mobile E2E User B',
      organization_name: 'Mobile E2E Org B',
      terms_accepted: true,
      terms_version: '2026.1',
      privacy_accepted: true,
      privacy_version: '2026.1',
      ai_consent: true,
      ai_consent_version: '2026.1',
      marketing_consent: false,
    }),
  });
  assert.equal(regB.status, 201, `Register User B failed: ${regB.raw}`);
  const loginB = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userBEmail, password }),
  });
  assert.equal(loginB.status, 200);
  const tokenB = loginB.data.access_token;
  assert.ok(tokenB);

  const userBList = await api('/documents', { headers: { Authorization: `Bearer ${tokenB}` } });
  assert.equal(userBList.status, 200);
  assert.equal(userBList.data.some((d) => d.id === uploadedDoc.id), false);

  const userBRead = await api(`/documents/${uploadedDoc.id}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.ok([403, 404].includes(userBRead.status), `Expected 403/404 on User B read, got ${userBRead.status}`);

  const userBDl = await api(`/documents/${uploadedDoc.id}/download`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.ok([403, 404].includes(userBDl.status), `Expected 403/404 on User B download, got ${userBDl.status}`);

  const userBDel = await api(`/documents/${uploadedDoc.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.ok([403, 404].includes(userBDel.status), `Expected 403/404 on User B delete, got ${userBDel.status}`);
  console.log('[E2E] 5. Cross-user tenant isolation (read/download/delete blocked 403/404) passed');

  // 6. Submit Job + History
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
  console.log('[E2E] 6. Jobs & processing history passed');

  // 7. Cloud Project Create, Rename (PATCH), Update (PUT), Version History & Cross-User Isolation
  const projRes = await api('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Mobile Sheet Sync',
      project_type: 'sheets',
      data: { sheetNames: ['Sheet1'], sheets: { Sheet1: [['A', 'B'], [1, 2]] } },
      note: 'Initial mobile sync',
    }),
  });
  assert.equal(projRes.status, 201, `Project create failed: ${projRes.raw}`);
  const projectId = projRes.data.id;
  assert.equal(projRes.data.version, 1);

  const userBProj = await api(`/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.ok([403, 404].includes(userBProj.status), `Expected 403/404 on User B project read, got ${userBProj.status}`);

  const renameRes = await api(`/projects/${projectId}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Mobile Sheet Sync Renamed', expected_version: 1 }),
  });
  assert.equal(renameRes.status, 200, `Project rename failed: ${renameRes.raw}`);
  assert.equal(renameRes.data.title, 'Mobile Sheet Sync Renamed');
  assert.equal(renameRes.data.version, 2);

  // Stale optimistic lock check on rename -> 409
  const staleRename = await api(`/projects/${projectId}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Stale Rename', expected_version: 1 }),
  });
  assert.equal(staleRename.status, 409, `Expected 409 on stale rename, got ${staleRename.status}`);

  // Update project payload (PUT /projects/{id}) -> increments to version 3 & records version snapshot
  const updateProjRes = await api(`/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: 'Mobile Sheet Sync v3',
      data: { sheetNames: ['Sheet1'], sheets: { Sheet1: [['A', 'B'], [10, 20]] } },
      expected_version: 2,
      note: 'Updated spreadsheet values',
    }),
  });
  assert.equal(updateProjRes.status, 200, `Project update failed: ${updateProjRes.raw}`);
  assert.equal(updateProjRes.data.version, 3);

  const versionsRes = await api(`/projects/${projectId}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(versionsRes.status, 200, `Project versions failed: ${versionsRes.raw}`);
  assert.ok(Array.isArray(versionsRes.data) && versionsRes.data.length >= 2);
  assert.equal(versionsRes.data[0].version_number, 3);
  console.log('[E2E] 7. Cloud project create, rename (PATCH), update (PUT), version history & isolation passed');

  // 8. Notifications & Preferences
  const notifRes = await api('/notifications', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(notifRes.status, 200);
  const prefRes = await api('/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ in_app_workflow: true }),
  });
  assert.equal(prefRes.status, 200);
  console.log('[E2E] 8. Notifications & preferences passed');

  // 9. Standard User RBAC check against Admin Route -> 403
  const forbiddenAdmin = await api('/admin/telemetry', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(forbiddenAdmin.status, 403);
  console.log('[E2E] 9. Standard user blocked from /admin/telemetry (403) passed');

  // 10. Password change & token rotation
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
  console.log('[E2E] 10. Password change & old token revocation passed');

  // 11. Promote user to admin in temp SQLite DB & verify Admin Portal Login + Telemetry
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
  assert.ok(telemetry.data.total_users >= 2);
  console.log('[E2E] 11. Admin login & telemetry passed');

  // 12. Logout & Token Revocation
  const logoutRes = await api('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(logoutRes.status, 200);
  const afterLogout = await api('/auth/me', { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(afterLogout.status, 401);
  console.log('[E2E] 12. Logout & token revocation (401) passed');

  // 13. AI consent opt-out & consent audit history
  const noAiEmail = `mobile_noai_${ts}@example.com`;
  const noAiReg = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: noAiEmail,
      password,
      full_name: 'Mobile NoAI E2E',
      organization_name: 'Mobile NoAI Org',
      terms_accepted: true,
      terms_version: '2026.1',
      privacy_accepted: true,
      privacy_version: '2026.1',
      ai_consent: false,
      marketing_consent: false,
    }),
  });
  assert.equal(noAiReg.status, 201, `No-AI register failed: ${JSON.stringify(noAiReg.data)}`);
  assert.equal(noAiReg.data.ai_consent, false);

  const noAiLogin = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: noAiEmail, password }),
  });
  assert.equal(noAiLogin.status, 200);
  let noAiToken = noAiLogin.data.access_token;

  const noAiMe = await api('/auth/me', {
    headers: { Authorization: `Bearer ${noAiToken}` },
  });
  assert.equal(noAiMe.status, 200);
  assert.equal(noAiMe.data.ai_consent, false);

  const consentHist = await api('/auth/consent/history', {
    headers: { Authorization: `Bearer ${noAiToken}` },
  });
  assert.equal(consentHist.status, 200);
  const aiConsentRec = consentHist.data.find((c) => c.consent_type === 'ai_processing');
  const termsRec = consentHist.data.find((c) => c.consent_type === 'terms_and_conditions');
  assert.ok(aiConsentRec && aiConsentRec.granted === false, 'ai_processing consent must stay false');
  assert.ok(termsRec && termsRec.granted === true, 'terms_and_conditions must be true');
  console.log('[E2E] 13. AI consent opt-out & consent history audit passed');

  // 14. One-time mobile authorization code exchange & replay/redirect protection
  const redirectUri = 'https://omnidoc-studio-jet.vercel.app/mobile/auth/callback';
  const codeCreate = await api('/auth/mobile-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noAiToken}`,
    },
    body: JSON.stringify({ redirect_uri: redirectUri }),
  });
  assert.ok(
    codeCreate.status === 200 || codeCreate.status === 201,
    `mobile-code create failed: ${codeCreate.status} ${JSON.stringify(codeCreate.data)}`
  );
  assert.ok(codeCreate.data.code, 'mobile-code must return an opaque code');

  const exchangeRes = await api('/auth/mobile-code/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeCreate.data.code, redirect_uri: redirectUri }),
  });
  assert.equal(exchangeRes.status, 200, `mobile-code exchange failed: ${JSON.stringify(exchangeRes.data)}`);
  assert.ok(exchangeRes.data.access_token);
  noAiToken = exchangeRes.data.access_token;

  const replayRes = await api('/auth/mobile-code/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeCreate.data.code, redirect_uri: redirectUri }),
  });
  assert.equal(replayRes.status, 400, 'Replayed mobile-code must be rejected with 400');

  const badRedirectRes = await api('/auth/mobile-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noAiToken}`,
    },
    body: JSON.stringify({ redirect_uri: 'https://evil.example.com/steal' }),
  });
  assert.equal(badRedirectRes.status, 400, 'Untrusted redirect_uri must be rejected with 400');
  console.log('[E2E] 14. Mobile one-time auth code exchange & replay/redirect protection passed');

  // 15. Workspace collaboration + cross-org 403 isolation
  const wsCreate = await api('/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noAiToken}`,
    },
    body: JSON.stringify({ name: `Mobile Collab ${ts}`, description: 'E2E workspace verification' }),
  });
  assert.ok(wsCreate.status === 200 || wsCreate.status === 201, `Workspace create failed: ${wsCreate.status}`);
  const wsId = wsCreate.data.id;

  const wsSampleTxtBytes = Buffer.from(
    'OmniDoc Studio Mobile E2E Collaboration Document.\nContract clause: payment net 30 days with mutual confidentiality.\n'
  );
  const wsForm = new FormData();
  wsForm.append('file', new Blob([wsSampleTxtBytes], { type: 'text/plain' }), 'workspace-e2e.txt');
  const wsUploadRes = await fetch(`${BASE_URL}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noAiToken}` },
    body: wsForm,
  });
  const wsUploadJson = await wsUploadRes.json();
  assert.equal(wsUploadRes.status, 201, `Workspace sample upload failed: ${JSON.stringify(wsUploadJson)}`);

  const wsShareDoc = await api(`/workspaces/${wsId}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noAiToken}`,
    },
    body: JSON.stringify({ document_id: wsUploadJson.id, permission: 'edit' }),
  });
  assert.ok(wsShareDoc.status === 200 || wsShareDoc.status === 201, `Share doc failed: ${wsShareDoc.status}`);

  const wsChat = await api(`/workspaces/${wsId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${noAiToken}`,
    },
    body: JSON.stringify({ body: 'Mobile E2E verification message' }),
  });
  assert.ok(wsChat.status === 200 || wsChat.status === 201, `Workspace message failed: ${wsChat.status}`);

  const crossOrgMembers = await api(`/workspaces/${wsId}/members`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(crossOrgMembers.status, 403, 'Cross-org user must receive 403 on workspace members');
  const crossOrgDocs = await api(`/workspaces/${wsId}/documents`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  assert.equal(crossOrgDocs.status, 403, 'Cross-org user must receive 403 on workspace documents');
  console.log('[E2E] 15. Workspace collaboration & cross-org 403 isolation passed');

  // 16. Tools catalog & RAG index availability
  const toolsList = await api('/tools', {
    headers: { Authorization: `Bearer ${noAiToken}` },
  });
  assert.equal(toolsList.status, 200);
  const ragIdx = await api(`/local-ai/rag/index/${wsUploadJson.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noAiToken}` },
  });
  assert.ok(
    ragIdx.status === 200 || ragIdx.status === 201,
    `RAG index returned unexpected ${ragIdx.status}: ${JSON.stringify(ragIdx.data)}`
  );
  console.log('[E2E] 16. Tools catalog & Local-AI RAG index passed');

  console.log('\nALL 16 REAL BACKEND E2E CHECKS PASSED!');
} catch (err) {
  console.error('[E2E] FAILED:', err);
  console.error('--- SERVER LOGS ---\n', serverLogs);
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
