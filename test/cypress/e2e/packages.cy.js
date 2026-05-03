/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Packages Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/packages');
  });

  it('should load the packages page', () => {
    cy.get('.packages-page').should('exist');
    cy.get('h1').should('contain', 'Packages');
  });

  it('should list installed packages', () => {
    cy.get('#packages-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    // Dashboard itself should be listed
    cy.get('#packages-body').should('contain', 'dashboard');
  });

  it('should filter packages by name', () => {
    cy.get('#packages-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);

    cy.get('#pkg-filter').type('dashboard');
    cy.get('#packages-body tr').should('have.length.greaterThan', 0);
    cy.get('#packages-body').should('contain', 'dashboard');

    cy.get('#pkg-filter').clear().type('zzz-nonexistent-zzz');
    cy.get('#packages-body .empty-state').should('exist');
  });

  it('should show install dialog when clicking Install button', () => {
    cy.get('#pkg-install-btn').click();
    cy.get('#install-dialog').should('be.visible');
    cy.get('#install-url').should('be.visible');

    cy.get('#install-cancel').click();
    cy.get('#install-dialog').should('not.be.visible');
  });

  it('should refresh package list', () => {
    cy.get('#packages-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#pkg-refresh').click();
    cy.get('#packages-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
  });

  it('should show remove buttons for each package', () => {
    cy.get('#packages-body tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#packages-body .remove-pkg').should('have.length.greaterThan', 0);
  });
});

describe('Packages API endpoint', () => {
  it('should return package list as JSON', () => {
    cy.loginApi();
    cy.request('/packages/data').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('packages');
      expect(response.body.packages).to.be.an('array');
      expect(response.body.packages.length).to.be.greaterThan(0);
    });
  });

  it('should require DBA authentication', () => {
    cy.clearCookies();
    cy.request({
      url: '/packages/data',
      failOnStatusCode: false,
    }).its('status').should('eq', 403);
  });
});

describe('Package install via URL and upload', () => {
  // A small, public .xar (airtable.xq v2.0.0) — chosen because it isn't part
  // of the default install and is unlikely to clash with other test fixtures.
  const xarUrl = 'https://github.com/joewiz/airtable.xq/releases/download/v2.0.0/airtable.xar';
  const filename = 'airtable.xar';

  // Look up any installed package whose abbrev/name contains "airtable" and remove it,
  // so a leftover from a previous failed run doesn't hide regressions.
  const cleanupAirtable = () => {
    cy.request({ url: '/packages/data', failOnStatusCode: false }).then((resp) => {
      if (!resp.body || !resp.body.packages) return;
      resp.body.packages
        .filter((p) =>
          (p.abbrev || '').toLowerCase().includes('airtable') ||
          (p.name || '').toLowerCase().includes('airtable')
        )
        .forEach((p) => {
          cy.request({
            method: 'POST',
            url: `/packages/action?action=remove&uri=${encodeURIComponent(p.name)}`,
            failOnStatusCode: false,
          });
        });
    });
  };

  beforeEach(() => {
    cy.loginApi();
    cleanupAirtable();
  });

  afterEach(cleanupAirtable);

  it('should install a package from an http URL', () => {
    cy.request({
      method: 'POST',
      url: `/packages/action?action=install&url=${encodeURIComponent(xarUrl)}`,
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body, JSON.stringify(resp.body)).to.have.property('status', 'installed');
    });

    cy.request('/packages/data').then((resp) => {
      const found = resp.body.packages.some((p) =>
        (p.abbrev || '').toLowerCase().includes('airtable') ||
        (p.name || '').toLowerCase().includes('airtable')
      );
      expect(found, 'airtable package present after install').to.be.true;
    });
  });

  it('should install a package via XAR upload', () => {
    // Fetch the .xar bytes via the test runner (not the browser) so we can
    // exercise the upload endpoint end-to-end without committing a binary fixture.
    cy.request({ url: xarUrl, encoding: 'binary' }).then((download) => {
      expect(download.status).to.eq(200);
      const body = Cypress.Blob.binaryStringToBlob(download.body, 'application/octet-stream');
      return cy.request({
        method: 'POST',
        url: `/packages/upload?filename=${encodeURIComponent(filename)}`,
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body, JSON.stringify(resp.body)).to.have.property('status', 'installed');
    });

    cy.request('/packages/data').then((resp) => {
      const found = resp.body.packages.some((p) =>
        (p.abbrev || '').toLowerCase().includes('airtable') ||
        (p.name || '').toLowerCase().includes('airtable')
      );
      expect(found, 'airtable package present after install').to.be.true;
    });
  });

  it('should reject upload with invalid filename', () => {
    cy.request({
      method: 'POST',
      url: '/packages/upload?filename=../evil.xar',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'PK\x03\x04',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.body).to.have.property('error');
    });
  });

  it('should require DBA authentication for upload', () => {
    cy.clearCookies();
    cy.request({
      method: 'POST',
      url: '/packages/upload?filename=foo.xar',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'PK\x03\x04',
      failOnStatusCode: false,
    }).its('status').should('eq', 403);
  });
});
