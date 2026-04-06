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
    cy.request('/exist/apps/dashboard/packages/data').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('packages');
      expect(response.body.packages).to.be.an('array');
      expect(response.body.packages.length).to.be.greaterThan(0);
    });
  });

  it('should require DBA authentication', () => {
    cy.clearCookies();
    cy.request({
      url: '/exist/apps/dashboard/packages/data',
      failOnStatusCode: false,
    }).its('status').should('eq', 403);
  });
});
