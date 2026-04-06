/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Console Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/console');
  });

  it('should load the console page', () => {
    cy.get('.console-page').should('exist');
    cy.get('h1').should('contain', 'Console');
  });

  it('should show query editor with run button', () => {
    cy.get('#query-input').should('be.visible');
    cy.get('#run-btn').should('be.visible');
  });

  it('should have a default query in the editor', () => {
    cy.get('#query-input').should('have.value', 'for $i in 1 to 10\nreturn $i');
  });

  it('should execute a simple query and show results', () => {
    cy.get('#query-input').clear().type('1 + 1');
    cy.get('#run-btn').click();

    cy.get('#result-panel', { timeout: 10000 }).should('contain', '2');
    cy.get('#error-panel').should('not.be.visible');
  });

  it('should execute the default query and show 10 items', () => {
    cy.get('#run-btn').click();

    cy.get('#result-panel', { timeout: 10000 }).should('be.visible');
    cy.get('#result-info').should('contain', '10 items');
  });

  it('should display error for invalid query', () => {
    cy.get('#query-input').clear().type('this is not valid xquery !!!');
    cy.get('#run-btn').click();

    cy.get('#error-panel', { timeout: 10000 }).should('be.visible');
    cy.get('#error-panel').should('not.be.empty');
  });

  it('should record query in history', () => {
    // Clear history
    cy.window().then((win) => {
      win.localStorage.removeItem('dashboard.queryHistory');
    });
    cy.visit('/console');

    cy.get('#query-input').clear().type('"hello"');
    cy.get('#run-btn').click();
    cy.get('#result-panel', { timeout: 10000 }).should('contain', 'hello');

    cy.get('#history-list .history-item').should('have.length.greaterThan', 0);
    cy.get('#history-list .history-item').first().should('contain', '"hello"');
  });

  it('should load query from history on click', () => {
    cy.get('#query-input').clear().type('"test-history"');
    cy.get('#run-btn').click();
    cy.get('#result-panel', { timeout: 10000 }).should('be.visible');

    cy.get('#query-input').clear().type('something else');
    cy.get('#history-list .history-item').first().click();
    cy.get('#query-input').should('have.value', '"test-history"');
  });

  it('should clear output when Clear button is clicked', () => {
    cy.get('#query-input').clear().type('1');
    cy.get('#run-btn').click();
    cy.get('#result-panel', { timeout: 10000 }).should('not.be.empty');

    cy.get('#clear-output').click();
    cy.get('#result-panel').should('be.empty');
  });

  it('should support serialization format selection', () => {
    cy.get('#serialization').should('be.visible');
    cy.get('#serialization option').should('have.length', 4);
    cy.get('#serialization').select('xml');
    cy.get('#serialization').should('have.value', 'xml');
  });
});
