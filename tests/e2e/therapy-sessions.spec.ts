import { expect, test as base, type Page } from '@playwright/test';

// These flows use the real Supabase SDK and the application's local demo
// transport. An attempted external account, database, or AI request fails.
const test = base.extend<{ offlineDemo: void }>({
  offlineDemo: [async ({ page, context, baseURL }, use) => {
    const externalRequests: string[] = [];
    const errors: string[] = [];
    const appOrigin = new URL(baseURL!).origin;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === appOrigin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (url.origin === 'https://fonts.googleapis.com') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      externalRequests.push(`${route.request().method()} ${url.href}`);
      return route.abort('blockedbyclient');
    });
    await use();
    expect(externalRequests, 'Therapy demo must not contact any external service').toEqual([]);
    expect(errors, 'Therapy demo must not raise uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

const DATA_KEY = 'siggy:demo:data:v1';
const NOW = new Date('2026-09-11T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const dialogFor = (page: Page) => page.getByRole('dialog', { name: 'Before your session', exact: true });
const noteFor = (page: Page) => dialogFor(page).getByLabel('Note for your therapist', { exact: true });
test.use({ timezoneId: 'UTC' });

async function enterDemo(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.getByRole('complementary', { name: 'Demo mode', exact: true })).toBeVisible();
  await page.goto('/therapy-sessions');
  await expect(page.getByRole('heading', { name: 'Therapy sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Write note', exact: true }).first()).toBeVisible();
}

async function switchView(page: Page, view: 'client' | 'clinician') {
  await page.goto(`/therapy-sessions?view=${view}`);
  await expect(page.getByRole('heading', { name: 'Therapy sessions', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

// Dates are fixture setup only; notes and review state are always changed by
// the same visible actions that clients and therapists use.
async function setSessionTimes(page: Page, scenarios: Array<{ offsetHours: number; status: 'scheduled' | 'cancelled' }>) {
  await page.evaluate(({ key, scenarios, now }) => {
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    const sample = stored.rows.therapy_sessions.find((session: { status: string; starts_at: string }) =>
      session.status === 'scheduled' && Date.parse(session.starts_at) > now);
    if (!sample) throw new Error('The demo needs a future session fixture.');
    stored.rows.therapy_sessions = scenarios.map((scenario, index) => ({
      ...sample,
      id: `eeeeeeee-eeee-4eee-8eee-${String(index + 1).padStart(12, '0')}`,
      starts_at: new Date(now + scenario.offsetHours * 60 * 60 * 1000).toISOString(),
      status: scenario.status,
    }));
    stored.rows.pre_session_notes = [];
    sessionStorage.setItem(key, JSON.stringify(stored));
  }, { key: DATA_KEY, scenarios, now: NOW.getTime() });
}

test.describe('Pre-session notes with the offline demo', () => {
  test('a private draft survives reload and is hidden from the therapist view', async ({ page }) => {
    await enterDemo(page);
    await expect(dialogFor(page)).toBeHidden();
    await page.getByRole('button', { name: 'Write note', exact: true }).first().click();
    await expect(dialogFor(page).getByText('Is there anything you would like your therapist to know?', { exact: true })).toBeVisible();
    const draft = 'Private demo draft: I would like to discuss a difficult conversation.';
    await noteFor(page).fill(draft);
    await dialogFor(page).getByRole('button', { name: 'Save private draft', exact: true }).click();
    await expect(dialogFor(page)).toBeHidden();
    const clientCard = page.getByRole('article').filter({ hasText: draft });
    await expect(clientCard).toBeVisible();
    await expect(clientCard).toContainText(/private draft/i);
    await page.reload();
    await expect(clientCard).toBeVisible();
    await clientCard.getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(noteFor(page)).toHaveValue(draft);
    await dialogFor(page).getByRole('button', { name: 'Not now', exact: true }).click();

    await switchView(page, 'clinician');
    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page.getByText(draft, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(draft, { exact: true })).toHaveCount(0);

    await switchView(page, 'client');
    await expect(clientCard).toBeVisible();
    await clientCard.getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(noteFor(page)).toHaveValue(draft);
  });

  test('sharing makes the note reviewable and an update clears the previous review', async ({ page }) => {
    test.setTimeout(60_000);
    await enterDemo(page);
    await page.getByRole('button', { name: 'Write note', exact: true }).first().click();
    const original = 'Shared demo note: please help me prepare for a conversation with my family.';
    await noteFor(page).fill(original);
    await dialogFor(page).getByRole('button', { name: 'Share with therapist', exact: true }).click();
    await expect(dialogFor(page)).toBeHidden();
    await expect(page.getByRole('article').filter({ hasText: original })).toContainText('Shared with therapist');

    await switchView(page, 'clinician');
    const sharedCard = page.getByRole('article').filter({ hasText: original });
    await expect(sharedCard).toBeVisible();
    await sharedCard.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await expect(sharedCard).toContainText('Reviewed by therapist');
    await expect(sharedCard.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveCount(0);

    await switchView(page, 'client');
    const clientCard = page.getByRole('article').filter({ hasText: original });
    await expect(clientCard).toContainText('Reviewed by therapist');
    await page.reload();
    await expect(clientCard).toContainText('Reviewed by therapist');
    await clientCard.getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(noteFor(page)).toHaveValue(original);
    const updated = 'Updated demo note: I also want to discuss setting a boundary at work.';
    await noteFor(page).fill(updated);
    await dialogFor(page).getByRole('button', { name: 'Update shared note', exact: true }).click();
    await expect(dialogFor(page)).toBeHidden();
    const updatedClientCard = page.getByRole('article').filter({ hasText: updated });
    await expect(updatedClientCard).toContainText('Shared with therapist');
    await expect(updatedClientCard).not.toContainText('Reviewed by therapist');

    await switchView(page, 'clinician');
    const updatedTherapistCard = page.getByRole('article').filter({ hasText: updated });
    await expect(updatedTherapistCard).toBeVisible();
    await expect(updatedTherapistCard).not.toContainText('Reviewed by therapist');
    await expect(updatedTherapistCard.getByRole('button', { name: 'Mark reviewed', exact: true })).toBeEnabled();
    await expect(page.getByText(original, { exact: true })).toHaveCount(0);
  });

  test('the automatic prompt opens in the 24-hour window and Not now snoozes it for an hour', async ({ page }) => {
    await page.clock.install({ time: NOW });
    await enterDemo(page);
    await setSessionTimes(page, [{ offsetHours: 25, status: 'scheduled' }]);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(dialogFor(page)).toBeHidden();

    // Crossing the threshold while the app stays open exercises its clock
    // subscription, rather than relying on navigation to produce the prompt.
    await page.clock.fastForward(2 * HOUR);
    await expect(dialogFor(page)).toBeVisible();
    await expect(dialogFor(page)).toContainText('Is there anything you would like your therapist to know?');
    await dialogFor(page).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(dialogFor(page)).toBeHidden();
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
    await expect(dialogFor(page)).toBeHidden();
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(dialogFor(page)).toBeHidden();

    await page.clock.fastForward(59 * 60 * 1000);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(dialogFor(page)).toBeHidden();
    await page.clock.fastForward(2 * 60 * 1000);
    await expect(dialogFor(page)).toBeVisible();
  });

  test('past and cancelled appointments never cause an automatic prompt', async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await enterDemo(page);
    await setSessionTimes(page, [
      { offsetHours: -1, status: 'scheduled' },
      { offsetHours: 2, status: 'cancelled' },
      { offsetHours: 48, status: 'scheduled' },
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Therapy sessions', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(dialogFor(page)).toBeHidden();
    await page.getByRole('button', { name: /^Past\s+\d+$/ }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Write note', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Cancelled\s+\d+$/ }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Write note', exact: true })).toHaveCount(0);
    await page.goto('/journal');
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(dialogFor(page)).toBeHidden();
  });

  test('a failed save retains the note when the appointment is cancelled while editing', async ({ page }) => {
    await enterDemo(page);
    await page.getByRole('button', { name: 'Write note', exact: true }).first().click();
    const draft = 'Retain this demo note if the appointment changes before I can share it.';
    await noteFor(page).fill(draft);
    // Simulate an appointment changing in another session after the editor
    // opens; the transport must reject this stale share without losing text.
    await page.evaluate(key => {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      for (const session of stored.rows.therapy_sessions) session.status = 'cancelled';
      sessionStorage.setItem(key, JSON.stringify(stored));
    }, DATA_KEY);
    await dialogFor(page).getByRole('button', { name: 'Share with therapist', exact: true }).click();
    await expect(dialogFor(page)).toBeVisible();
    await expect(noteFor(page)).toHaveValue(draft);
    await expect(dialogFor(page).getByRole('alert')).toBeVisible();
    await expect(dialogFor(page).getByRole('button', { name: 'Share with therapist', exact: true })).toBeEnabled();
    expect(await page.evaluate(({ key, body }) => {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      return stored.rows.pre_session_notes.some((note: { body: string }) => note.body === body);
    }, { key: DATA_KEY, body: draft })).toBe(false);
  });

  test('a stale note shows the latest saved version and saves kept text only after an explicit retry', async ({ page }) => {
    await enterDemo(page);
    const original = 'Initial private demo note before editing in two places.';
    await page.getByRole('button', { name: 'Write note', exact: true }).first().click();
    await noteFor(page).fill(original);
    await dialogFor(page).getByRole('button', { name: 'Save private draft', exact: true }).click();
    await expect(dialogFor(page)).toBeHidden();
    await page.getByRole('article').filter({ hasText: original }).getByRole('button', { name: 'Edit note', exact: true }).click();
    await expect(noteFor(page)).toHaveValue(original);
    const typed = 'My current demo text: I would like to discuss changes at work.';
    const latest = 'A newer saved demo version: please leave time for a family concern.';
    await noteFor(page).fill(typed);
    // Another browser session saved after this editor took its snapshot. The
    // revision must conflict even though the local query has not refetched yet.
    await page.evaluate(({ key, original, latest }) => {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      const note = stored.rows.pre_session_notes.find((row: { body: string }) => row.body === original);
      if (!note) throw new Error('The private note was not saved.');
      note.body = latest;
      note.updated_at = new Date(Date.parse(note.updated_at) + 1000).toISOString();
      sessionStorage.setItem(key, JSON.stringify(stored));
    }, { key: DATA_KEY, original, latest });
    const save = dialogFor(page).getByRole('button', { name: 'Save private draft', exact: true });
    await save.click();
    await expect(dialogFor(page).getByRole('alert')).toContainText('This note changed');
    await expect(dialogFor(page).getByText(latest, { exact: true })).toBeVisible();
    await expect(noteFor(page)).toHaveValue(typed);
    await expect(save).toBeDisabled();
    await expect(dialogFor(page).getByRole('button', { name: 'Load saved version', exact: true })).toBeVisible();
    await dialogFor(page).getByRole('button', { name: 'Keep my text', exact: true }).click();
    await expect(noteFor(page)).toHaveValue(typed);
    await expect(save).toBeEnabled();
    expect(await page.evaluate(({ key, latest }) => {
      const stored = JSON.parse(sessionStorage.getItem(key)!);
      return stored.rows.pre_session_notes.some((note: { body: string }) => note.body === latest);
    }, { key: DATA_KEY, latest })).toBe(true);
    await save.click();
    await expect(dialogFor(page)).toBeHidden();
    const saved = page.getByRole('article').filter({ hasText: typed });
    await expect(saved).toContainText('Private draft');
    await page.reload();
    await expect(saved).toBeVisible();
    await expect(page.getByText(latest, { exact: true })).toHaveCount(0);
  });

  test('an invited demo connection can schedule, reschedule, and cancel a session reflected in the calendar', async ({ page }) => {
    test.setTimeout(60_000);
    await page.clock.setFixedTime(NOW);
    await enterDemo(page);
    await switchView(page, 'clinician');
    await page.getByRole('button', { name: 'Manage connections', exact: true }).click();
    const invitations = page.getByRole('dialog', { name: 'Client connections', exact: true });
    await invitations.getByLabel('Client', { exact: true }).selectOption({ label: 'Casey Morgan (sample)' });
    const therapist = 'Dr. Demo Browser';
    await invitations.getByLabel('Your name as your client knows it', { exact: true }).fill(therapist);
    await invitations.getByRole('button', { name: 'Create invitation', exact: true }).click();
    await expect(invitations.getByText('Invitation for Casey Morgan (sample)', { exact: true })).toBeVisible();
    const code = invitations.getByLabel(/^One-time code/);
    await expect(code).toHaveValue(/^[a-f\d-]{36}$/i);
    const invitationCode = await code.inputValue();

    await switchView(page, 'client');
    await page.getByRole('button', { name: 'Manage connection', exact: true }).click();
    const connection = page.getByRole('dialog', { name: 'Connect with your therapist', exact: true });
    await connection.getByLabel('Invitation code', { exact: true }).fill(invitationCode);
    await connection.getByRole('button', { name: 'Check invitation', exact: true }).click();
    await expect(connection.getByRole('heading', { name: therapist, exact: true })).toBeVisible();
    await connection.getByRole('button', { name: 'Accept and connect', exact: true }).click();
    await expect(connection.getByRole('status')).toContainText(`You are now connected with ${therapist}.`);
    await switchView(page, 'client');
    await page.getByRole('button', { name: 'Schedule session', exact: true }).click();
    const schedule = page.getByRole('dialog', { name: 'Schedule a session', exact: true });
    await schedule.getByLabel('Therapist', { exact: true }).selectOption({ label: therapist });
    await schedule.getByLabel('Date and time', { exact: true }).fill('2026-09-20T14:30');
    await schedule.getByLabel('Session length (minutes)', { exact: true }).fill('60');
    await schedule.getByRole('button', { name: 'Schedule session', exact: true }).click();
    await expect(schedule).toBeHidden();
    const clientCard = page.getByRole('article').filter({ hasText: therapist });
    await expect(clientCard).toContainText('Sunday, September 20, 2026');
    await expect(clientCard).toContainText('2:30 PM · 60 min');

    await page.goto('/calendar');
    await page.getByRole('button', { name: 'September 20, has therapy session', exact: true }).click();
    const selectedDay = page.getByRole('region', { name: 'Selected day', exact: true });
    const calendarSession = selectedDay.getByRole('link').filter({ hasText: `Therapy with ${therapist}` });
    await expect(calendarSession).toContainText('2:30 PM · 60 min');
    await calendarSession.click();
    await clientCard.getByRole('button', { name: 'Reschedule', exact: true }).click();
    const reschedule = page.getByRole('dialog', { name: 'Reschedule session', exact: true });
    await reschedule.getByLabel('Date and time', { exact: true }).fill('2026-09-21T15:45');
    await reschedule.getByLabel('Session length (minutes)', { exact: true }).fill('75');
    await reschedule.getByRole('button', { name: 'Review changes', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirm your new time', exact: true });
    await expect(confirmation).toContainText('Monday, September 21, 2026');
    await expect(confirmation).toContainText('3:45 PM');
    await confirmation.getByRole('button', { name: 'Confirm reschedule', exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect(reschedule).toBeHidden();
    await expect(clientCard).toContainText('Monday, September 21, 2026');
    await expect(clientCard).toContainText('3:45 PM · 75 min');

    await page.goto('/calendar');
    await expect(page.getByRole('button', { name: 'September 20', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'September 21, has therapy session', exact: true }).click();
    await expect(calendarSession).toContainText('3:45 PM · 75 min');
    await switchView(page, 'clinician');
    const clinicianCard = page.getByRole('article').filter({ hasText: 'Casey Morgan (sample)' });
    await expect(clinicianCard).toContainText('Monday, September 21, 2026');
    await clinicianCard.getByRole('button', { name: 'Cancel session', exact: true }).click();
    const cancel = page.getByRole('dialog', { name: 'Cancel this session?', exact: true });
    await cancel.getByRole('button', { name: 'Cancel session', exact: true }).click();
    await expect(cancel).toBeHidden();
    await expect(clinicianCard).toHaveCount(0);

    await switchView(page, 'client');
    await page.getByRole('button', { name: /^Cancelled\s+\d+$/ }).click();
    await expect(clientCard).toContainText('Cancelled');
    await expect(clientCard.getByRole('button', { name: 'Write note', exact: true })).toHaveCount(0);
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'September 21', exact: true }).click();
    await expect(calendarSession).toContainText('Cancelled');
  });

  test('the demo check-in dialog fits a 390px screen and can save a private draft', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemo(page);
    await page.getByRole('button', { name: 'Try pre-session check-in', exact: true }).click();
    const dialog = dialogFor(page);
    await expect(dialog).toBeVisible();
    await expect(noteFor(page)).toBeVisible();
    for (const label of ['Save private draft', 'Share with therapist']) {
      const button = dialog.getByRole('button', { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await noteFor(page).fill('Mobile demo draft: I would like to talk about my week.');
    await dialog.getByRole('button', { name: 'Save private draft', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('article').filter({ hasText: 'Mobile demo draft: I would like to talk about my week.' })).toBeVisible();
  });
});
