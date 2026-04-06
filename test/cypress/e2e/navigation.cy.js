/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Tab Navigation', () => {
  beforeEach(() => {
    cy.loginApi();
  });

  it('should load the Home tab by default', () => {
    cy.visit('/');
    cy.get('.home-page').should('exist');
    cy.get('.dashboard-tabs a.active').should('contain', 'Home');
  });

  const tabs = [
    { path: '/packages', heading: 'Packages', cssClass: '.packages-page' },
    { path: '/users', heading: 'Users', cssClass: '.users-page' },
    { path: '/monitoring', heading: 'Monitoring', cssClass: '.monitoring-page' },
    { path: '/profiling', heading: 'Profiling', cssClass: '.profiling-page' },
    { path: '/console', heading: 'Console', cssClass: '.console-page' },
    { path: '/indexes', heading: 'Indexes', cssClass: '.indexes-page' },
    { path: '/system', heading: 'System', cssClass: '.system-page' },
  ];

  tabs.forEach(({ path, heading, cssClass }) => {
    it(`should navigate to ${heading} tab via direct URL`, () => {
      cy.visit(path);
      cy.get(cssClass).should('exist');
      cy.get('h1').should('contain', heading);
    });
  });

  it('should highlight the active tab in the navigation bar', () => {
    cy.visit('/monitoring');
    cy.get('.dashboard-tabs a.active').should('contain', 'Monitoring');
  });

  it('should navigate between tabs via clicks', () => {
    cy.visit('/');
    cy.get('.dashboard-tabs a').contains('Packages').click();
    cy.url().should('include', '/packages');
    cy.get('.packages-page').should('exist');
  });
});
