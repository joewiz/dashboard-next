/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Profiling Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/profiling');
  });

  it('should load the profiling page', () => {
    cy.get('.profiling-page').should('exist');
    cy.get('h1').should('contain', 'Profiling');
  });

  it('should show tracing status', () => {
    cy.get('#prof-status').should('be.visible');
  });

  it('should enable and disable tracing', () => {
    cy.get('#prof-enable').click();
    cy.get('#prof-status').should('contain', 'ON');

    cy.get('#prof-disable').click();
    cy.get('#prof-status').should('contain', 'OFF');
  });

  it('should collect trace data after enabling', () => {
    // Enable tracing
    cy.get('#prof-enable').click();
    cy.get('#prof-status').should('contain', 'ON');

    // Generate some activity by hitting an endpoint
    cy.request('/exist/apps/dashboard/login');

    // Refresh trace data
    cy.get('#prof-refresh').click();

    // Should have at least one traced query
    cy.get('#queries-data tr').should('have.length.greaterThan', 0);

    // Clean up
    cy.get('#prof-disable').click();
    cy.get('#prof-clear').click();
  });

  it('should switch between Queries, Functions, and Index Usage sub-tabs', () => {
    cy.get('#panel-queries').should('be.visible');

    cy.get('.tab-btn').contains('Functions').click();
    cy.get('#panel-functions').should('be.visible');
    cy.get('#panel-queries').should('not.be.visible');

    cy.get('.tab-btn').contains('Index Usage').click();
    cy.get('#panel-indexes').should('be.visible');
    cy.get('#panel-functions').should('not.be.visible');
  });

  it('should clear trace data', () => {
    cy.get('#prof-enable').click();
    cy.request('/exist/apps/dashboard/login');
    cy.get('#prof-refresh').click();
    cy.get('#prof-clear').click();
    cy.get('#prof-refresh').click();
    cy.get('#queries-data .empty-state').should('exist');

    cy.get('#prof-disable').click();
  });
});
