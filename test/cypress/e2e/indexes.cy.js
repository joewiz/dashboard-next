/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

describe('Indexes Tab', () => {
  beforeEach(() => {
    cy.loginAndVisit('/indexes');
  });

  it('should load the indexes page', () => {
    cy.get('.indexes-page').should('exist');
    cy.get('h1').should('contain', 'Indexes');
  });

  it('should populate the collection dropdown', () => {
    cy.get('#idx-collection option', { timeout: 10000 }).should('have.length.greaterThan', 1);
  });

  it('should display indexes when a collection is selected', () => {
    cy.get('#idx-collection option', { timeout: 10000 }).should('have.length.greaterThan', 1);
    // Select the first real collection (index 1, after the placeholder)
    cy.get('#idx-collection').then(($select) => {
      const options = $select.find('option');
      if (options.length > 1) {
        cy.get('#idx-collection').select(options.eq(1).val());
        cy.get('#idx-body tr').should('have.length.greaterThan', 0);
      }
    });
  });
});

describe('Indexes API endpoint', () => {
  it('should return configured collections', () => {
    cy.loginApi();
    cy.request('/indexes/collections').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.have.property('collections');
      expect(response.body.collections).to.be.an('array');
    });
  });
});
