/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 *
 * Custom Cypress commands for dashboard-next testing.
 */

/**
 * Log in via the login endpoint with session caching.
 * Dashboard uses eXist's persistent login module (org.exist.login).
 */
Cypress.Commands.add('loginApi', () => {
  cy.session(
    'admin-login',
    () => {
      cy.request({
        method: 'POST',
        url: '/login',
        form: true,
        body: {
          user: 'admin',
          password: '',
          duration: 'P7D',
        },
      }).then(({ headers }) => {
        const sessionCookie = headers['set-cookie']?.find((c) =>
          c.startsWith('JSESSIONID=')
        );
        if (sessionCookie) {
          const value = sessionCookie.split(';')[0].split('=')[1];
          cy.setCookie('JSESSIONID', value);
        }
      });
    },
    {
      validate() {
        cy.request({
          url: '/login',
          failOnStatusCode: false,
        }).its('status').should('eq', 200);
      },
      cacheAcrossSpecs: true,
    }
  );
});

/**
 * Log in and navigate to a specific tab.
 */
Cypress.Commands.add('loginAndVisit', (tab = '/') => {
  cy.loginApi();
  cy.visit(tab);
});
