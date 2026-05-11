import { expect, test } from '@playwright/test';

test('redirects to onboarding on first visit', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/onboarding/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Bonjour/i);
});

test('onboarding form requires a name', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Commencer/ }).click();
  // HTML required attribute should keep us on the same page
  await expect(page).toHaveURL(/onboarding/);
});
