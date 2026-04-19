/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Launcher Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/');
  });

  it('should display the Launcher heading', () => {
    cy.get('h1').should('contain', 'Launcher');
  });

  it('should display installed application tiles', () => {
    cy.get('.launcher-grid .launcher-tile').should('have.length.greaterThan', 0);
  });

  it('should include the dashboard itself', () => {
    cy.get('.launcher-grid').should('contain', 'Dashboard');
  });
});
