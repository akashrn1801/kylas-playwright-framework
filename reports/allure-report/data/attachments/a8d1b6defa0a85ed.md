# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rbac/leads.rbac.spec.ts >> Leads RBAC >> Restricted user can edit own lead
- Location: tests/rbac/leads.rbac.spec.ts:26:7

# Error details

```
Test timeout of 90000ms exceeded.
```

```
Error: page.waitForLoadState: Target page, context or browser has been closed
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - banner [ref=e4]:
        - navigation [ref=e5]:
          - generic [ref=e6]:
            - generic [ref=e7]:
              - button [disabled] [ref=e10] [cursor=pointer]
              - img "Company logo" [ref=e12]
              - heading "Microsoft teams" [level=1] [ref=e15] [cursor=pointer]
            - generic [ref=e16]:
              - generic [ref=e17]:
                - img [ref=e19]
                - generic [ref=e22]: Leads
              - generic [ref=e25]:
                - generic [ref=e27]: 
                - textbox "Search across Leads, Deal and more..." [ref=e30]:
                  - /placeholder: Search across Leads, Deal  and more...
            - generic [ref=e31]:
              - generic "Installed Apps" [ref=e32]:
                - img [ref=e34] [cursor=pointer]
              - generic [ref=e45]:
                - button "" [ref=e46] [cursor=pointer]:
                  - generic [ref=e47]: 
                - text:     
              - generic [ref=e48]:
                - img [ref=e49]
                - generic [ref=e51] [cursor=pointer]: "2"
              - generic [ref=e54] [cursor=pointer]: 
              - generic [ref=e55]:
                - generic [ref=e56] [cursor=pointer]: 
                - generic [ref=e57]: "50"
              - generic [ref=e60]:
                - button "C" [disabled] [ref=e61] [cursor=pointer]: C
                - text:     
      - complementary [ref=e63]:
        - navigation [ref=e64]:
          - list [ref=e65]:
            - list [ref=e66]:
              - listitem [ref=e69] [cursor=pointer]:
                - img [ref=e70]
              - listitem [ref=e75] [cursor=pointer]:
                - img [ref=e76]
              - listitem [ref=e81] [cursor=pointer]:
                - img [ref=e82]
              - listitem [ref=e89] [cursor=pointer]:
                - img [ref=e90]
              - listitem [ref=e95] [cursor=pointer]:
                - img [ref=e96]
              - listitem [ref=e103] [cursor=pointer]:
                - img [ref=e104]
              - listitem [ref=e110] [cursor=pointer]:
                - img [ref=e111]
              - listitem [ref=e116] [cursor=pointer]:
                - img [ref=e117]
              - listitem [ref=e122] [cursor=pointer]:
                - img [ref=e123]
              - listitem [ref=e128] [cursor=pointer]:
                - img [ref=e129]
              - listitem [ref=e133] [cursor=pointer]:
                - img [ref=e134]
              - listitem [ref=e141] [cursor=pointer]:
                - img [ref=e143]
            - listitem [ref=e153] [cursor=pointer]:
              - img [ref=e154]
      - main [ref=e157]:
        - generic [ref=e158]:
          - generic [ref=e159]:
            - heading "All leads " [level=1] [ref=e162]:
              - generic [ref=e163]:
                - text: All leads
                - generic [ref=e164] [cursor=pointer]: 
            - generic [ref=e165]:
              - generic [ref=e166]:
                - button [ref=e167] [cursor=pointer]:
                  - img [ref=e168]
                - generic [ref=e172]:
                  - searchbox "Search" [ref=e173]: Blake
                  - img [ref=e176] [cursor=pointer]
                - generic [ref=e182]:
                  - generic [ref=e183]:
                    - generic [ref=e185]:
                      - img [ref=e186]
                      - generic [ref=e189]: List
                    - textbox [ref=e192]
                  - img [ref=e196] [cursor=pointer]
                - button [ref=e198] [cursor=pointer]:
                  - img [ref=e199]
                - button [ref=e202] [cursor=pointer]:
                  - img [ref=e203]
                - text:  
                - generic: 
                - button "Add" [ref=e207] [cursor=pointer]
              - generic [ref=e208]:
                - generic [ref=e209]: 1 items
                - generic [ref=e211]: Sorted by Updated At, Descending
          - generic [ref=e212]:
            - grid [ref=e213]:
              - row "F Name  Pipeline Stage  Last Name  Phone Numbers  Emails  Latest Notes  Multi value picklist  Multi picklist test 1 " [ref=e215]:
                - columnheader [ref=e216]:
                  - checkbox [ref=e219]
                - columnheader "F Name " [ref=e220]:
                  - generic [ref=e223]:
                    - generic [ref=e225] [cursor=pointer]: F Name
                    - button "" [ref=e227] [cursor=pointer]:
                      - generic [ref=e228]: 
                - columnheader "Pipeline Stage " [ref=e230]:
                  - generic [ref=e233]:
                    - generic [ref=e235]: Pipeline Stage
                    - button "" [ref=e237] [cursor=pointer]:
                      - generic [ref=e238]: 
                - columnheader "Last Name " [ref=e240]:
                  - generic [ref=e243]:
                    - generic [ref=e245] [cursor=pointer]: Last Name
                    - button "" [ref=e247] [cursor=pointer]:
                      - generic [ref=e248]: 
                - columnheader "Phone Numbers " [ref=e250]:
                  - generic [ref=e253]:
                    - generic [ref=e255]: Phone Numbers
                    - button "" [ref=e257] [cursor=pointer]:
                      - generic [ref=e258]: 
                - columnheader "Emails " [ref=e260]:
                  - generic [ref=e263]:
                    - generic [ref=e265]: Emails
                    - button "" [ref=e267] [cursor=pointer]:
                      - generic [ref=e268]: 
                - columnheader "Latest Notes " [ref=e270]:
                  - generic [ref=e273]:
                    - generic [ref=e275]: Latest Notes
                    - button "" [ref=e277] [cursor=pointer]:
                      - generic [ref=e278]: 
                - columnheader "Multi value picklist " [ref=e280]:
                  - generic [ref=e283]:
                    - generic [ref=e285]: Multi value picklist
                    - button "" [ref=e287] [cursor=pointer]:
                      - generic [ref=e288]: 
                - columnheader "Multi picklist test 1 " [ref=e290]:
                  - generic [ref=e293]:
                    - generic [ref=e295]: Multi picklist test 1
                    - button "" [ref=e297] [cursor=pointer]:
                      - generic [ref=e298]: 
                - columnheader [ref=e300]
              - rowgroup [ref=e302]:
                - 'row "Jude - Fadel Mobile: +91****086  Office: blake_kris@yahoo.com View notes - - " [ref=e303]':
                  - gridcell [ref=e304] [cursor=pointer]:
                    - checkbox [ref=e306]
                  - gridcell "Jude" [ref=e307] [cursor=pointer]:
                    - generic [ref=e308]: Jude
                  - gridcell "-" [ref=e309] [cursor=pointer]:
                    - generic [ref=e310]: "-"
                  - gridcell "Fadel" [ref=e311] [cursor=pointer]:
                    - generic [ref=e312]: Fadel
                  - 'gridcell "Mobile: +91****086 " [ref=e313] [cursor=pointer]':
                    - generic [ref=e315]:
                      - generic [ref=e316]: "Mobile: +91****086"
                      - img [ref=e320]
                      - button "" [ref=e322]:
                        - generic [ref=e323]: 
                  - 'gridcell "Office: blake_kris@yahoo.com" [ref=e324] [cursor=pointer]':
                    - generic [ref=e327]: "Office: blake_kris@yahoo.com"
                  - gridcell "View notes" [ref=e328] [cursor=pointer]:
                    - generic [ref=e329]: View notes
                  - gridcell "-" [ref=e330] [cursor=pointer]
                  - gridcell "-" [ref=e331] [cursor=pointer]
                  - gridcell "" [ref=e332] [cursor=pointer]:
                    - button "" [ref=e334]:
                      - generic [ref=e335]: 
            - generic:
              - generic: Loading...
          - navigation "Page navigation example" [ref=e336]:
            - generic [ref=e338]: Showing 1 - 1 of 1 items
            - generic [ref=e339]:
              - generic [ref=e340]: Results per page
              - generic [ref=e343]:
                - generic [ref=e344]:
                  - generic [ref=e345]: "100"
                  - textbox [ref=e348]
                - img [ref=e352] [cursor=pointer]
            - list [ref=e354]:
              - listitem [ref=e355]:
                - link "First":
                  - /url: ""
              - listitem [ref=e356]:
                - link "1" [ref=e357] [cursor=pointer]:
                  - /url: ""
              - listitem [ref=e358]:
                - link "Last":
                  - /url: ""
    - img "Chat Bot" [ref=e362] [cursor=pointer]
  - generic [ref=e363]:
    - generic [ref=e364]:
      - generic [ref=e365]:
        - button [ref=e366] [cursor=pointer]:
          - img [ref=e367]
        - button [ref=e369] [cursor=pointer]:
          - img [ref=e370]
      - paragraph [ref=e372]: Secured by viaSocket
    - iframe [ref=e373]:
      - generic [ref=f43e4]:
        - generic [ref=f43e6]:
          - group "Platform" [ref=f43e9]:
            - button "Integrations" [pressed] [ref=f43e10] [cursor=pointer]
            - button "History" [ref=f43e11] [cursor=pointer]
          - button "Add New Integration Choose from over 2,500+ apps to supercharge your workflow and unlock powerful automation. Browse Integrations" [ref=f43e14] [cursor=pointer]:
            - heading "Add New Integration" [level=4] [ref=f43e15]
            - paragraph [ref=f43e16]: Choose from over 2,500+ apps to supercharge your workflow and unlock powerful automation.
            - button "Browse Integrations" [ref=f43e22]:
              - img [ref=f43e24]
              - text: Browse Integrations
        - generic [ref=f43e26]:
          - separator [ref=f43e27]
          - generic [ref=f43e28]:
            - generic [ref=f43e29]:
              - heading "2,500+" [level=6] [ref=f43e30]
              - paragraph [ref=f43e31]: Available Apps
            - generic [ref=f43e32]:
              - heading "100%" [level=6] [ref=f43e33]
              - paragraph [ref=f43e34]: Secure
            - generic [ref=f43e35]:
              - heading "24/7" [level=6] [ref=f43e36]
              - paragraph [ref=f43e37]: Support
  - complementary
  - iframe [ref=e374]:
    - generic [ref=f63e4]:
      - generic [ref=f63e5]:
        - heading "Announcements" [level=3] [ref=f63e7]
        - generic [ref=f63e8]:
          - link "Features Kylas 5.7 Release. Data Import Import Users No manuall works to add your users into the system, just simply upload ..." [ref=f63e9] [cursor=pointer]:
            - /url: "#"
            - generic [ref=f63e10]: Features
            - strong [ref=f63e11]: Kylas 5.7 Release.
            - text: Data Import Import Users No manuall works to add your users into the system, just simply upload ...
          - link "Features Kylas 5.6 Release. Rule Engine on Call entity Rule engine helps you to set conditional logic in order to freeze the..." [ref=f63e12] [cursor=pointer]:
            - /url: "#"
            - generic [ref=f63e13]: Features
            - strong [ref=f63e14]: Kylas 5.6 Release.
            - text: Rule Engine on Call entity Rule engine helps you to set conditional logic in order to freeze the...
        - link "Learn more" [ref=f63e16] [cursor=pointer]:
          - /url: https://headwayapp.co/kylas-sales-crm-updates?utm_medium=widget
      - generic [ref=f63e17]:
        - generic [ref=f63e18]:
          - generic [ref=f63e19]:
            - link [ref=f63e20] [cursor=pointer]:
              - /url: "#back"
            - heading "Kylas 5.7 Release" [level=3] [ref=f63e21]
          - generic [ref=f63e22]:
            - paragraph
        - generic [ref=f63e24]:
          - generic [ref=f63e25]:
            - link [ref=f63e26] [cursor=pointer]:
              - /url: "#back"
            - heading "Kylas 5.6 Release" [level=3] [ref=f63e27]
          - paragraph [ref=f63e30]:
            - link "Read more" [ref=f63e31] [cursor=pointer]:
              - /url: https://headwayapp.co/kylas-sales-crm-updates/kylas-5-6-release-325990
  - tooltip "Leads" [ref=e375]:
    - generic [ref=e377]: Leads
  - log [ref=e378]
```

# Test source

```ts
  110 |   async clickAddLead(): Promise<void> {
  111 |     logger.info('Clicking Add Lead button');
  112 |     await this.click(this.addButton(), 'add lead button');
  113 |     await this.page.waitForTimeout(1000);
  114 |   }
  115 | 
  116 |   // ─── Form Helper Actions ──────────────────────────────────
  117 | 
  118 |   private async disableRequiredFieldsToggle(): Promise<void> {
  119 |     try {
  120 |       const toggle = this.showRequiredToggle();
  121 |       const isVisible = await toggle.isVisible({ timeout: 3000 });
  122 |       if (isVisible) {
  123 |         logger.info('Disabling Show Required & Important Fields toggle');
  124 |         await toggle.click();
  125 |         await this.page.waitForTimeout(800);
  126 |       }
  127 |     } catch {
  128 |       // Toggle not present
  129 |     }
  130 |   }
  131 | 
  132 |   // ─── Fill Form ────────────────────────────────────────────
  133 | 
  134 |   async fillLeadForm(data: LeadData): Promise<void> {
  135 |     logger.info('Filling lead creation form');
  136 | 
  137 |     await this.disableRequiredFieldsToggle();
  138 | 
  139 |     // Basic info
  140 |     await this.fill(this.firstNameInput(), data.firstName, 'first name');
  141 |     await this.fill(this.lastNameInput(), data.lastName, 'last name');
  142 | 
  143 |     // Email
  144 |     await this.click(this.addEmailButton(), 'add email button');
  145 |     await this.page.waitForTimeout(300);
  146 |     await this.fill(this.emailInput(), data.email, 'email');
  147 | 
  148 |     // Phone
  149 |     await this.click(this.addPhoneButton(), 'add phone button');
  150 |     await this.page.waitForTimeout(500);
  151 |     await this.fill(this.phoneInput(), data.phone, 'phone');
  152 | 
  153 |     // Address
  154 |     await this.fill(this.addressInput(), data.address, 'address');
  155 |     await this.fill(this.cityInput(), data.city, 'city');
  156 |     await this.fill(this.stateInput(), data.state, 'state');
  157 |     await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');
  158 | 
  159 |     // Social
  160 |     await this.fill(this.facebookInput(), data.facebook, 'facebook');
  161 |     await this.fill(this.twitterInput(), data.twitter, 'twitter');
  162 |     await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');
  163 | 
  164 |     // Company info
  165 |     await this.fill(this.companyNameInput(), data.companyName, 'company name');
  166 |     await this.fill(this.departmentInput(), data.department, 'department');
  167 |     await this.fill(this.designationInput(), data.designation, 'designation');
  168 |     await this.fill(this.companyAddressInput(), data.companyAddress, 'company address');
  169 |     await this.fill(this.companyCityInput(), data.companyCity, 'company city');
  170 |     await this.fill(this.companyStateInput(), data.companyState, 'company state');
  171 |     await this.fill(this.companyZipcodeInput(), data.companyZipcode, 'company zipcode');
  172 | 
  173 |     logger.success('Lead form filled successfully');
  174 |   }
  175 | 
  176 |  async saveLead(): Promise<void> {
  177 |     logger.info('Saving lead');
  178 |     await this.click(this.saveButton(), 'save button');
  179 |     await this.page.waitForTimeout(2000);
  180 |     // Explicitly navigate back to leads list
  181 |     await this.navigateTo('https://app.kylas.io/sales/leads/list');
  182 |     await this.waitForUrl(/leads\/list/);
  183 |     logger.success('Lead saved successfully');
  184 |   }
  185 | 
  186 |   // ─── Search & Open ────────────────────────────────────────
  187 | 
  188 | async searchAndOpenLead(firstName: string): Promise<void> {
  189 |     logger.info(`Searching for lead: ${firstName}`);
  190 |     await this.navigateTo('https://app.kylas.io/sales/leads/list');
  191 |     await this.waitForUrl(/leads\/list/);
  192 |     await this.page.waitForLoadState('networkidle');
  193 |     await this.fill(this.searchInput(), firstName, 'search input');
  194 |     await this.page.keyboard.press('Enter');
  195 |     await this.page.waitForLoadState('networkidle');
  196 | 
  197 |     const nameCell = this.page.locator('.rt-tr-group .clip-text')
  198 |       .filter({ hasText: firstName })
  199 |       .first();
  200 |     await nameCell.waitFor({ state: 'visible', timeout: 20000 });
  201 |     await nameCell.click();
  202 |     await this.page.waitForURL(/sales\/leads\/details\//, { timeout: 15000 });
  203 |     logger.success(`Opened lead: ${firstName}`);
  204 |   }
  205 |   // ─── List Assertion ───────────────────────────────────────
  206 | 
  207 | async assertLeadExistsInList(firstName: string, lastName: string): Promise<void> {
  208 |     logger.info(`Asserting lead in list: ${firstName} ${lastName}`);
  209 |     await this.waitForUrl(/leads\/list/);
> 210 |     await this.page.waitForLoadState('networkidle');
      |                     ^ Error: page.waitForLoadState: Target page, context or browser has been closed
  211 |     await this.fill(this.searchInput(), firstName, 'search input');
  212 |     await this.page.keyboard.press('Enter');
  213 |     await this.page.waitForLoadState('networkidle');
  214 | 
  215 |     const nameCell = this.page.locator('.rt-tr-group .clip-text')
  216 |       .filter({ hasText: firstName })
  217 |       .first();
  218 |     await expect(nameCell).toBeVisible({ timeout: 20000 });
  219 |     logger.success(`Lead found in list: ${firstName} ${lastName}`);
  220 |   }
  221 |   // ─── Edit Lead ────────────────────────────────────────────
  222 | 
  223 |   async clickEditIcon(): Promise<void> {
  224 |     logger.info('Clicking edit icon');
  225 |     await this.click(this.editIconButton(), 'edit icon');
  226 |     await this.page.waitForTimeout(1000);
  227 |     logger.success('Edit form opened');
  228 |   }
  229 | 
  230 |   async fillEditForm(data: LeadData): Promise<void> {
  231 |     logger.info('Filling edit form');
  232 |     await this.fill(this.editFirstNameInput(), data.firstName, 'first name');
  233 |     await this.fill(this.editLastNameInput(), data.lastName, 'last name');
  234 |     logger.success('Edit form filled');
  235 |   }
  236 | 
  237 |   async saveEditedLead(): Promise<void> {
  238 |     logger.info('Saving edited lead');
  239 |     await this.click(this.editSaveButton(), 'save button');
  240 |     await this.page.waitForTimeout(2000);
  241 |     logger.success('Lead updated successfully');
  242 |   }
  243 | 
  244 |   // ─── Assertions ───────────────────────────────────────────
  245 | 
  246 |   async assertOnLeadsListPage(): Promise<void> {
  247 |     await this.assertUrl(/leads\/list/);
  248 |   }
  249 | 
  250 |   async assertOnLeadDetailPage(): Promise<void> {
  251 |     await this.assertUrl(/sales\/leads\/details\//);
  252 |   }
  253 | }
```