/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('System Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/system');
  });

  it('should load the system page', () => {
    cy.get('.system-page').should('exist');
    cy.get('h1').should('contain', 'System');
  });

  it('should display version information', () => {
    cy.get('#card-version .stat-value').should('not.be.empty');
    cy.get('#card-version .stat-value').should('contain', 'eXist');
  });

  it('should display uptime', () => {
    cy.get('#uptime-value', { timeout: 15000 }).should('not.be.empty');
    cy.get('#uptime-value').invoke('text').should('match', /\d+[dhm]/);
  });

  it('should display memory usage with progress bar', () => {
    cy.get('#card-memory .stat-detail').should('not.contain', '--');
    cy.get('#memory-bar').should('have.attr', 'style').and('not.contain', 'width: 0%');
  });

  it('should display package count', () => {
    cy.get('#packages-value').invoke('text').then((text) => {
      expect(parseInt(text)).to.be.greaterThan(0);
    });
  });

  it('should display database information', () => {
    cy.get('#sys-db tbody tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
    cy.get('#sys-db').should('contain', 'eXist');
  });

  it('should display Java information', () => {
    cy.get('#sys-java tbody tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
  });

  it('should display OS information', () => {
    cy.get('#sys-os tbody tr', { timeout: 10000 }).should('have.length.greaterThan', 0);
  });
});

describe('System API endpoint', () => {
  it('should return system info as JSON', () => {
    cy.loginApi();
    cy.request('/system/data').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('db');
      expect(response.body.db).to.have.property('name');
      expect(response.body.db).to.have.property('version');
      expect(response.body).to.have.property('java');
      expect(response.body.java).to.have.property('version');
      expect(response.body).to.have.property('os');
      expect(response.body).to.have.property('uptime');
      expect(response.body.uptime).to.be.greaterThan(0);
    });
  });

  it('should require DBA authentication', () => {
    cy.clearCookies();
    cy.request({
      url: '/system/data',
      failOnStatusCode: false,
    }).its('status').should('eq', 403);
  });
});
