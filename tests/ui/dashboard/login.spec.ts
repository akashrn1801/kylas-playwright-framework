import { test } from '@playwright/test';
import { LoginPage } from '../../../src/modules/dashboard/LoginPage';

test.describe('Login', () => {

  test('@smoke @regression @prodSafe login page should be visible before authentication', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.assertLoginPageVisible();
  });

  test('@smoke @regression admin credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.login(process.env.QA_ADMIN_EMAIL!, process.env.QA_ADMIN_PASSWORD!);
    await loginPage.assertLoggedIn();
  });

  test('@regression restricted credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.login(process.env.QA_RESTRICTED_EMAIL!, process.env.QA_RESTRICTED_PASSWORD!);
    await loginPage.assertLoggedIn();
  });

  test('@regression invalid credentials should show error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.login('invalid@email.com', 'wrongpassword');
    await loginPage.assertLoginError();
  });

});
