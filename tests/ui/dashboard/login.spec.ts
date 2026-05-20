import { test, expect } from '../../../src/fixtures/index';
import { LoginPage } from '../../../src/modules/dashboard/LoginPage';

test.describe('Login Tests', () => {

  test('Admin user should login successfully', async ({ adminPage }) => {
    await expect(adminPage).toHaveURL(/sales\/home/);
  });

  test('Restricted user should login successfully', async ({ restrictedPage }) => {
    await expect(restrictedPage).toHaveURL(/sales\/home/);
  });

  test('Login page should be visible', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.assertLoginPageVisible();
  });

  test('Invalid credentials should show error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.loginWithCredentials('invalid@email.com', 'wrongpassword');
    await loginPage.assertErrorMessageVisible();
  });

});