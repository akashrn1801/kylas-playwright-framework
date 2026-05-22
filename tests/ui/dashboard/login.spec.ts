import { test, expect } from '../../../src/fixtures/index';
import { LoginPage } from '../../../src/modules/dashboard/LoginPage';

test.describe('Login', () => {

  // WHY: these tests use raw `page` (no pre-auth) so they actually test login
  test('login page should be visible before authentication', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.assertLoginPageVisible();
  });

  test('admin credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    // WHY: loginAs navigates AND waits for /sales/home — a real end-to-end login test
    await loginPage.loginAs('admin');
    await expect(page).toHaveURL(/sales\/home/);
  });

  test('restricted credentials should log in successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.loginAs('restricted');
    await expect(page).toHaveURL(/sales\/home/);
  });

  test('invalid credentials should show error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.loginWithCredentials('invalid@email.com', 'wrongpassword');
    await loginPage.assertErrorMessageVisible();
  });

});
