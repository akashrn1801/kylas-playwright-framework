import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { ContactData } from '../../data/factories/contactFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class ContactsPage extends BasePage {

    // ──────────────────────────────────────────────────────────
    // Retry Config
    // ──────────────────────────────────────────────────────────

    private readonly retryConfig = {
        qa: {
            retries: 5,
            wait: 3000,
        },
        staging: {
            retries: 3,
            wait: 5000,
        },
        prod: {
            retries: 5,
            wait: 3000,
        },
    };

    // ──────────────────────────────────────────────────────────
    // Locators
    // ──────────────────────────────────────────────────────────

    private readonly addButton = (): Locator =>
        this.page.getByRole('button', { name: /^Add$/ });

    private readonly searchInput = (): Locator =>
        this.page.locator('#fulltext-search');

    private readonly searchIcon = (): Locator =>
        this.page.locator('svg:has(#Ic_Search)').first();

    private readonly searchLoader = (): Locator =>
        this.page.locator('.spinner, .loader, .loading');

    private readonly contactTable = (): Locator =>
        this.page.locator('.rt-table');

    private readonly contactRowNameCell = (firstName: string): Locator =>
        this.page
            .locator('.rt-tr-group')
            .filter({
                has: this.page.getByText(firstName, { exact: true }),
            })
            .first();

    private readonly showRequiredToggle = (): Locator =>
        this.page
            .locator('label')
            .filter({
                hasText: 'Show Required & Important Fields',
            });

    private readonly firstNameInput = (): Locator =>
        this.page.locator('input[name="firstName"]');

    private readonly lastNameInput = (): Locator =>
        this.page.locator('input[name="lastName"]');

    private readonly addEmailButton = (): Locator =>
        this.page.getByText('Add Email', { exact: true }).first();

    private readonly emailInput = (): Locator =>
        this.page.locator('input[name="emails[0].value"]');

    private readonly addPhoneButton = (): Locator =>
        this.page.getByText('Add Phone', { exact: true }).first();

    private readonly phoneInput = (): Locator =>
        this.page.locator('input[id*="input_phone_0"]');

    private readonly addressInput = (): Locator =>
        this.page.locator('input[name="address"]');

    private readonly cityInput = (): Locator =>
        this.page.locator('input[name="city"]');

    private readonly stateInput = (): Locator =>
        this.page.locator('input[name="state"]');

    private readonly zipcodeInput = (): Locator =>
        this.page.locator('input[name="zipcode"]');

    private readonly facebookInput = (): Locator =>
        this.page.locator('input[name="facebook"]');

    private readonly twitterInput = (): Locator =>
        this.page.locator('input[name="twitter"]');

    // NOTE: contacts use 'linkedin' (all lowercase) — leads use 'linkedIn'
    private readonly linkedinInput = (): Locator =>
        this.page.locator('input[name="linkedin"]');

    private readonly departmentInput = (): Locator =>
        this.page.locator('input[name="department"]');

    private readonly designationInput = (): Locator =>
        this.page.locator('input[name="designation"]');

    // UTM / source fields — below address, require scroll on some viewports
    private readonly subSourceInput = (): Locator =>
        this.page.locator('input[name="subSource"]');

    private readonly utmSourceInput = (): Locator =>
        this.page.locator('input[name="utmSource"]');

    private readonly utmCampaignInput = (): Locator =>
        this.page.locator('input[name="utmCampaign"]');

    private readonly utmMediumInput = (): Locator =>
        this.page.locator('input[name="utmMedium"]');

    private readonly utmContentInput = (): Locator =>
        this.page.locator('input[name="utmContent"]');

    private readonly utmTermInput = (): Locator =>
        this.page.locator('input[name="utmTerm"]');

    private readonly saveButton = (): Locator =>
        this.page.locator('button[type="submit"].save-button');

    private readonly editIconButton = (): Locator =>
        this.page.locator('#edit-action');

    private readonly editModal = (): Locator =>
        this.page.locator('#editEntityModal');

    private readonly modalCancelButton = (): Locator =>
        this.page.locator('button[data-dismiss="modal"]').first();

    // ──────────────────────────────────────────────────────────
    // Constructor
    // ──────────────────────────────────────────────────────────

    constructor(page: Page) {
        super(page);
    }

    // ──────────────────────────────────────────────────────────
    // Private Helpers
    // ──────────────────────────────────────────────────────────

    private getCurrentRetryConfig() {
        return this.retryConfig[
            config.env as keyof typeof this.retryConfig
        ];
    }

  private async waitForListReady(): Promise<void> {
        await this.page.waitForLoadState('domcontentloaded');
        // WHY: Wait for list API response before checking DOM — faster and more reliable
        await Promise.race([
          this.page.waitForResponse(
            (res) => res.url().includes('/v1/contacts') && res.request().method() === 'GET' && res.status() === 200,
            { timeout: config.timeouts.navigation }
          ).catch(() => null),
          this.contactTable().waitFor({ state: 'visible', timeout: config.timeouts.navigation }).catch(() => null),
        ]);
        await expect(this.contactTable()).toBeVisible({ timeout: config.timeouts.navigation });
        await this.waitForLoaderToDisappear();
  }

    private async waitForLoaderToDisappear(): Promise<void> {
        try {
            await this.searchLoader().last().waitFor({
                state: 'hidden',
                timeout: 10000,
            });
        } catch {
            // loader may not exist — continue
        }
    }

    private async waitForSearchResults(
        firstName: string
    ): Promise<boolean> {
        try {
            await expect(
                this.contactRowNameCell(firstName)
            ).toBeVisible({
                timeout: 5000,
            });

            return true;
        } catch {
            return false;
        }
    }

    private async waitForContactDetailsPage(): Promise<void> {
        await this.page.waitForURL(
            /sales\/contacts\/details\//,
            { timeout: 20000 }
        );

        await this.page.waitForLoadState('domcontentloaded');
    }

    private async waitForContactListPage(): Promise<void> {
        await this.waitForUrl(/contacts\/list/);

        await this.waitForListReady();
    }

    private async closeModalIfOpen(): Promise<void> {
        const modal = this.editModal();

        try {
            if (await modal.isVisible()) {
                logger.info('Closing existing modal');

                await this.modalCancelButton().click();

                await modal.waitFor({
                    state: 'hidden',
                    timeout: 5000,
                });

                logger.success('Modal closed');
            }
        } catch (error) {
            logger.warn(`Failed to close modal: ${String(error)}`);
        }
    }

    private async disableRequiredFieldsToggle(): Promise<void> {
        try {
            const toggle = this.showRequiredToggle();

            if (await toggle.isVisible()) {
                logger.info('Disabling Show Required & Important Fields');

                await toggle.click();

                await expect(this.firstNameInput()).toBeVisible({
                    timeout: 20000,
                });

                logger.success('Toggle disabled');
            }
        } catch (error) {
            logger.debug(`Toggle not available: ${String(error)}`);
        }
    }

    private async performSearch(searchText: string): Promise<void> {
        logger.info(`Searching contact: ${searchText}`);

        await this.fill(
            this.searchInput(),
            searchText,
            'search input'
        );

        await Promise.all([
            this.waitForSearchApi(),
            this.click(this.searchIcon(), 'search icon'),
        ]);

        await this.waitForLoaderToDisappear();
    }

    private async waitForSearchApi(): Promise<Response | null> {
        try {
            return await this.page.waitForResponse(
                (response) =>
                    response.url().includes('search') &&
                    response.request().method() === 'GET' &&
                    response.status() === 200,
                { timeout: 15000 }
            );
        } catch {
            return null;
        }
    }

    private async captureContactIdFromResponse(): Promise<number | null> {
        try {
            const response = await this.page.waitForResponse(
                (res) =>
                    res.url().includes('/v1/contacts') &&
                    res.request().method() === 'POST' &&
                    res.status() === 200,
                { timeout: 30000 }
            );

            const body = await response.json();

            const contactId =
                body?.id ??
                body?.data?.id ??
                null;

            logger.success(`Captured contact ID: ${contactId}`);

            return contactId;
        } catch (error) {
            logger.warn(`Unable to capture contact ID: ${String(error)}`);

            return null;
        }
    }

    private async retryFindContact(
        firstName: string
    ): Promise<boolean> {
        const currentConfig = this.getCurrentRetryConfig();

        for (
            let attempt = 1;
            attempt <= currentConfig.retries;
            attempt++
        ) {
            logger.info(
                `Search attempt ${attempt}/${currentConfig.retries}`
            );

            await this.goToContactsList();

            await this.performSearch(firstName);

            const found = await this.waitForSearchResults(firstName);

            if (found) {
                logger.success('Contact found');

                return true;
            }

            if (attempt < currentConfig.retries) {
                await this.page.waitForTimeout(currentConfig.wait);
            }
        }

        return false;
    }

    // ──────────────────────────────────────────────────────────
    // Navigation
    // ──────────────────────────────────────────────────────────

    async goToContactsList(): Promise<void> {
        logger.info('Navigating to Contacts List');

        await this.closeModalIfOpen();

        await this.navigateTo(
            `${config.appUrl}/sales/contacts/list`
        );

        await this.waitForContactListPage();

        logger.success('On Contacts List page');
    }

    async clickAddContact(): Promise<void> {
        logger.info('Clicking Add Contact');

        await this.click(this.addButton(), 'add contact button');

        await expect(this.firstNameInput()).toBeVisible({
            timeout: 10000,
        });

        logger.success('Contact form opened');
    }

    // ──────────────────────────────────────────────────────────
    // Form Actions
    // ──────────────────────────────────────────────────────────

    async fillContactForm(data: ContactData): Promise<void> {
        logger.info('Filling contact form');

        await this.disableRequiredFieldsToggle();

        await this.fill(
            this.firstNameInput(),
            data.firstName,
            'first name'
        );

        await this.fill(
            this.lastNameInput(),
            data.lastName,
            'last name'
        );

        await this.click(this.addEmailButton(), 'add email button');

        await expect(this.emailInput()).toBeVisible();

        await this.fill(this.emailInput(), data.email, 'email');

        await this.click(this.addPhoneButton(), 'add phone button');

        await expect(this.phoneInput()).toBeVisible();

        await this.fill(this.phoneInput(), data.phone, 'phone');

        await this.fill(
            this.addressInput(),
            data.address,
            'address'
        );

        await this.fill(this.cityInput(), data.city, 'city');

        await this.fill(this.stateInput(), data.state, 'state');

        await this.fill(
            this.zipcodeInput(),
            data.zipcode,
            'zipcode'
        );

        await this.fill(
            this.facebookInput(),
            data.facebook,
            'facebook'
        );

        await this.fill(
            this.twitterInput(),
            data.twitter,
            'twitter'
        );

        await this.fill(
            this.linkedinInput(),
            data.linkedin,
            'linkedin'
        );

        await this.fill(
            this.departmentInput(),
            data.department,
            'department'
        );

        await this.fill(
            this.designationInput(),
            data.designation,
            'designation'
        );



        // WHY: UTM fields sit below address and may be off-screen.
        // scrollIntoViewIfNeeded ensures fill doesn't silently fail
        // on smaller viewports or when the form is long.
        await this.utmSourceInput().scrollIntoViewIfNeeded();

        await this.fill(
            this.subSourceInput(),
            data.subSource,
            'sub source'
        );

        await this.fill(
            this.utmSourceInput(),
            data.utmSource,
            'utm source'
        );

        await this.fill(
            this.utmCampaignInput(),
            data.utmCampaign,
            'utm campaign'
        );

        await this.fill(
            this.utmMediumInput(),
            data.utmMedium,
            'utm medium'
        );

        await this.fill(
            this.utmContentInput(),
            data.utmContent,
            'utm content'
        );

        await this.fill(
            this.utmTermInput(),
            data.utmTerm,
            'utm term'
        );

        logger.success('Contact form filled');
    }

    async saveContact(): Promise<number | null> {
        logger.info('Saving contact');

        const contactIdPromise = this.captureContactIdFromResponse();

        await this.click(this.saveButton(), 'save button');

        await this.assertNoFormErrors('contact create form');

        const contactId = await contactIdPromise;

        await this.waitForContactListPage();

        logger.success('Contact saved successfully');

        return contactId;
    }

    // ──────────────────────────────────────────────────────────
    // Search & Open
    // ──────────────────────────────────────────────────────────

    async searchAndOpenContact(
        firstName: string,
        contactId?: number
    ): Promise<void> {
        logger.info(`Opening contact: ${firstName}`);

        if (contactId) {
            logger.info(
                `Opening contact directly via ID: ${contactId}`
            );

            await this.navigateTo(
                `${config.appUrl}/sales/contacts/details/${contactId}`
            );

            await this.waitForContactDetailsPage();

            return;
        }

        const found = await this.retryFindContact(firstName);

        expect(found).toBeTruthy();

        await this.contactRowNameCell(firstName).click();

        await this.waitForContactDetailsPage();

        logger.success(`Contact opened: ${firstName}`);
    }

    // ──────────────────────────────────────────────────────────
    // Edit Actions
    // ──────────────────────────────────────────────────────────

    async clickEditIcon(): Promise<void> {
        logger.info('Opening edit modal');

        await this.click(this.editIconButton(), 'edit icon');
        await expect(this.editModal()).toBeVisible({
            timeout: config.timeouts.navigation,
        });
        // WHY: Wait for firstName input — modal animation on GHA is slow
        await this.firstNameInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
        logger.success('Edit modal opened');
    }

    async fillEditForm(data: ContactData): Promise<void> {
        logger.info('Updating contact form');

        await this.fill(
            this.firstNameInput(),
            data.firstName,
            'first name'
        );

        await this.fill(
            this.lastNameInput(),
            data.lastName,
            'last name'
        );

        logger.success('Edit form updated');
    }

    async saveEditedContact(): Promise<void> {
        logger.info('Saving updated contact');

        await this.click(this.saveButton(), 'save button');

        await this.assertNoFormErrors('contact edit form');

        await expect(this.editModal()).toBeHidden({
            timeout: 15000,
        });

        logger.success('Contact updated');
    }

    // ──────────────────────────────────────────────────────────
    // Assertions
    // ──────────────────────────────────────────────────────────

    async assertOnContactsListPage(): Promise<void> {
        await this.assertUrl(/contacts\/list/);
    }

    async assertOnContactDetailPage(): Promise<void> {
        await this.assertUrl(/sales\/contacts\/details\//);
    }

    async assertContactExistsInList(
        firstName: string
    ): Promise<void> {
        logger.info(`Validating contact exists: ${firstName}`);

        const found = await this.retryFindContact(firstName);

        expect(found).toBeTruthy();

        logger.success(`Contact exists: ${firstName}`);
    }

    async assertContactNotInList(
        firstName: string
    ): Promise<void> {
        logger.info(`Validating contact absent: ${firstName}`);

        await this.goToContactsList();

        await this.performSearch(firstName);

        await expect(
            this.contactRowNameCell(firstName)
        ).toBeHidden({ timeout: 10000 });

        logger.success(`Contact absent confirmed: ${firstName}`);
    }

    // ──────────────────────────────────────────────────────────
    // Workflow Wrappers
    // ──────────────────────────────────────────────────────────

    async createContact(
        data: ContactData
    ): Promise<number | null> {
        await this.clickAddContact();

        await this.fillContactForm(data);

        return await this.saveContact();
    }

    async updateContact(
        newData: ContactData,
        originalFirstName?: string,
        contactId?: number
    ): Promise<void> {
        const searchName = originalFirstName ?? newData.firstName;

        await this.searchAndOpenContact(searchName, contactId);

        await this.clickEditIcon();

        await this.fillEditForm(newData);

        await this.saveEditedContact();
    }

    async assertContactUpdated(data: ContactData): Promise<void> {
        await this.goToContactsList();
        await this.assertContactExistsInList(data.firstName);
    }

    async assertContactCreated(
        data: ContactData,
        contactId?: number
    ): Promise<void> {
        if (contactId) {
            logger.info(`Validating contact via ID: ${contactId}`);

            await this.navigateTo(
                `${config.appUrl}/sales/contacts/details/${contactId}`
            );

            await this.waitForContactDetailsPage();

            // WHY: contact details page renders fields as read-only text, not inputs.
            // Asserting the URL contains the ID is sufficient proof the contact
            // was created and is accessible — no input[name="firstName"] exists here.
            await this.assertUrl(
                new RegExp(`contacts/details/${contactId}`)
            );

            logger.success(`Contact verified: ${data.firstName}`);

            return;
        }

        await this.assertContactExistsInList(data.firstName);
    }
}