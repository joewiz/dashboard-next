/*
 * SPDX LGPL-2.1-or-later
 * Copyright (C) 2001-2026 The eXist-db Authors
 */
/// <reference types="cypress" />

/**
 * Tests that the Running Queries table in the Monitoring tab correctly
 * displays long-running queries captured by JMX polling.
 */
describe('Monitoring — Running Queries', () => {
  beforeEach(() => {
    cy.loginAndVisit('/monitoring');
  });

  it('detects long-running query via JMX polling', () => {
    // Launch a long-running query from the browser context (non-blocking)
    cy.window().then((win) => {
      // Fire-and-forget a 15-second query
      win.fetch('/exist/rest/db?_query=' + encodeURIComponent('util:wait(15000), "done"') + '&_wrap=no', {
        credentials: 'include',
      });
    });

    // Wait for the next JMX poll cycle (3s default) to pick up the query
    // The Running Queries table should show at least one entry
    cy.get('#queries-body tr', { timeout: 15000 })
      .should('not.contain', 'No running queries');

    // Verify the row has meaningful content (source, elapsed, status)
    cy.get('#queries-body tr').first().within(() => {
      cy.get('td').should('have.length.gte', 3);
    });
  });

  it('JMX poll returns running queries in XML', () => {
    // Directly verify that the /status endpoint returns RunningQueries
    // when a query is active. Use window.fetch to avoid Cypress baseUrl issues.
    cy.window().then((win) => {
      // Start a long query
      win.fetch('/exist/rest/db?_query=' + encodeURIComponent('util:wait(10000), "done"') + '&_wrap=no', {
        credentials: 'include',
      });
    });

    cy.wait(1500);

    // Fetch JMX status from within the browser context to avoid Cypress baseUrl
    cy.window().then((win) => {
      const token = win.document.getElementById('jmx-token')?.value || '';
      expect(token).to.not.be.empty;

      return new Cypress.Promise((resolve, reject) => {
        win.fetch(`/exist/status?c=processes&token=${encodeURIComponent(token)}`)
          .then(r => r.text())
          .then(text => {
            expect(text).to.contain('RunningQueries');
            expect(text).to.contain('sourceKey');
            resolve();
          })
          .catch(reject);
      });
    });
  });

  it('parses RunningQueries XML correctly', () => {
    // Unit-test the XML parsing logic with known JMX XML
    cy.window().then((win) => {
      const JMX_NS = 'http://exist-db.org/jmx';
      const xml = new win.DOMParser().parseFromString(`
        <jmx:jmx xmlns:jmx="http://exist-db.org/jmx" version="1">
          <jmx:ProcessReport name="test">
            <jmx:RunningQueries>
              <jmx:row>
                <jmx:key><jmx:id>123</jmx:id><jmx:key>test.xql</jmx:key></jmx:key>
                <jmx:value>
                  <jmx:elapsed>5000</jmx:elapsed>
                  <jmx:id>123</jmx:id>
                  <jmx:sourceKey>/db/test.xql</jmx:sourceKey>
                  <jmx:sourceType>DB</jmx:sourceType>
                  <jmx:terminating>false</jmx:terminating>
                  <jmx:thread>thread-1</jmx:thread>
                  <jmx:requestURI>/test</jmx:requestURI>
                </jmx:value>
              </jmx:row>
            </jmx:RunningQueries>
          </jmx:ProcessReport>
        </jmx:jmx>
      `, 'text/xml');

      // Test getElementsByTagNameNS
      const rqEls = xml.getElementsByTagNameNS(JMX_NS, 'RunningQueries');
      expect(rqEls.length).to.eq(1, 'Should find RunningQueries element');

      const rows = rqEls[0].getElementsByTagNameNS(JMX_NS, 'row');
      expect(rows.length).to.eq(1, 'Should find one row inside RunningQueries');

      const row = rows[0];
      const sourceKeyEls = row.getElementsByTagNameNS(JMX_NS, 'sourceKey');
      expect(sourceKeyEls.length).to.be.gte(1, 'Should find sourceKey in row');
      expect(sourceKeyEls[0].textContent.trim()).to.eq('/db/test.xql');

      const idEls = row.getElementsByTagNameNS(JMX_NS, 'id');
      expect(idEls.length).to.be.gte(1, 'Should find id in row');
      // First id is inside <key>, which is fine for display
      expect(idEls[0].textContent.trim()).to.eq('123');

      const threadEls = row.getElementsByTagNameNS(JMX_NS, 'thread');
      expect(threadEls.length).to.eq(1, 'Should find thread in row');
      expect(threadEls[0].textContent.trim()).to.eq('thread-1');
    });
  });

  it('scheduled jobs should populate', () => {
    // ScheduledJobs come from the same JMX poll
    cy.get('#scheduled-jobs-body', { timeout: 10000 })
      .should('not.contain', 'Loading');
    // Should have at least one scheduled job (FileLockHeartBeat, Sessions.Check, etc.)
    cy.get('#scheduled-jobs-body tr').should('have.length.gte', 1);
  });
});
