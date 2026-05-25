import { test } from '@playwright/test';
import { LoginPage } from '../../../src/modules/dashboard/LoginPage';
import { config } from '../../../config/config';

test.describe('Login', () => {

  test('@smoke @regression @prodSafe login page should be visible before authentication', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.assertLoginPageVisible();
  });

  test('@smoke @regression admin credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.loginWithCredentials(config.users.admin.email, config.users.admin.password);
    await loginPage.assertLoggedIn();
  });

  test('@regression restricted credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.loginWithCredentials(config.users.restricted.email, config.users.restricted.password);
    await loginPage.assertLoggedIn();
  });

  test('@regression invalid credentials should show error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigateTo('/');
    await loginPage.loginWithCredentials('invalid@email.com', 'wrongpassword');
    await loginPage.assertErrorMessageVisible();
  });

});
