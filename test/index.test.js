'use strict';

var Analytics = require('@segment/analytics.js-core').constructor;
var sandbox = require('@segment/clear-env');
var tester = require('@segment/analytics.js-integration-tester');
var Optimizely = require('../lib/');

/**
 * Test account: han@segment.com
 */

var mockOptimizelyDataObject = function() {
  window.optimizely.data = {
    experiments: {
      0: { name: 'Test' },
      1: { name: 'MultiVariate Test' },
      2: { name: 'Inactive Test' },
      11: { name: 'Redirect Test' } },
    variations: {
      22: { name: 'Redirect Variation', code: '' },
      123: { name: 'Variation #123', code: '' },
      789: { name: 'Var 789', code: '' },
      44: { name: 'Var 44', code: '' }
    },
    sections: { 1: { name: 'Section 1', variation_ids: [123, 22, 789] } },
    state: {
      activeExperiments: [0, 1],
      variationNamesMap: {
        0: 'Variation1',
        1: 'Variation #123, Redirect Variation, Var 789', // this is the data format
        2: 'Inactive Variation',
        11: 'Redirect Variation' },
      variationIdsMap: { 0: [123], 1: [123, 22, 789], 11: [22], 2: [44] },
      redirectExperiment: {
        variationId: 22,
        experimentId: 11,
        referrer: 'google.com'
      }
    }
  };
};

describe('Optimizely', function() {
  var analytics;
  var optimizely;
  var options = { listen: false, nonInteraction: false };

  beforeEach(function() {
    analytics = new Analytics();
    optimizely = new Optimizely(options);
    analytics.use(Optimizely);
    analytics.use(tester);
    analytics.add(optimizely);
    mockOptimizelyDataObject();
  });

  afterEach(function() {
    analytics.restore();
    analytics.reset();
    optimizely.reset();
    sandbox();
  });

  describe('before loading', function() {
    beforeEach(function() {
      analytics.stub(optimizely, 'load');
      analytics.stub(optimizely, 'sendClassicDataToSegment');
      analytics.stub(optimizely, 'sendNewDataToSegment');
      analytics.stub(optimizely, 'setEffectiveReferrer');
      analytics.stub(window, 'initOptimizelyIntegration');
    });

    describe('#initialize', function() {
      beforeEach(function(done) {
        analytics.stub(window.optimizely, 'push');
        analytics.once('ready', done);
        analytics.initialize();
        mockOptimizelyDataObject();
        analytics.page();
      });

      // FIXME
      it.skip('should call initOptimizelyIntegration', function() {
        analytics.called(window.initOptimizelyIntegration, {
          referrerOverride: optimizely.setEffectiveReferrer,
          sendExperimentData: optimizely.sendClassicDataToSegment,
          sendCampaignData: optimizely.sendNewDataToSegment
        });
      });

      it('should flag source of integration', function() {
        analytics.called(window.optimizely.push, {
          type: 'integration',
          OAuthClientId: '5360906403'
        });
      });
    });

    describe('#initialize on settings change', function() {
      it('should not call #replay if variations are disabled', function(done) {
        optimizely.options.variations = false;
        analytics.initialize();
        mockOptimizelyDataObject();
        analytics.page();
        analytics.on('ready', tick(function() {
          analytics.didNotCall(optimizely.replay);
          done();
        })
         );
      });

      it('should call #roots if listen is enabled', function(done) {
        optimizely.options.listen = true;
        analytics.initialize();
        mockOptimizelyDataObject();
        analytics.page();
        analytics.on('ready', tick(function() {
          analytics.called(optimizely.roots);
          done();
        })
        );
      });
    });
  });

  describe('#replay', function() {
    beforeEach(function() {
      analytics.stub(analytics, 'identify');
    });

    it('should replay variation traits', function(done) {
      optimizely.options.variations = true;
      analytics.initialize();
      mockOptimizelyDataObject();
      analytics.page();
      tick(function() {
        analytics.called(analytics.identify, {
          'Experiment: Test': 'Variation1',
          'Experiment: MultiVariate Test': 'Variation2',
          'Experiment: Inactive Test': 'Inactive Variation',
          'Experiment: Redirect Test': 'Redirect Variation'
        });
        done();
      });
    });
  });

  describe('#roots', function() {
    beforeEach(function(done) {
      analytics.stub(analytics, 'track');
      optimizely.options.listen = true;
      analytics.once('ready', done);
      analytics.initialize();
      mockOptimizelyDataObject();
    });

    it('should send active experiments', function(done) {
      window.optimizely.data.state.activeExperiments = [0];
      window.optimizely.data.state.redirectExperiment = undefined;
      analytics.page();
      tick(function() {
        analytics.called(analytics.track, 'Experiment Viewed', {
          experimentId: 0,
          experimentName: 'Test',
          variationId: '123',
          variationName: 'Variation1' },
          { context: { integration: { name: 'optimizely', version: '1.0.0' } }
        });
        done();
      });
    });

    it('should send active multiVariate experiments', function(done) {
      window.optimizely.data.state.activeExperiments = [1];
      window.optimizely.data.state.redirectExperiment = undefined;
      analytics.page();
      tick(function() {
        analytics.called(analytics.track, 'Experiment Viewed', {
          sectionName: 'Section 1',
          experimentId: 1,
          experimentName: 'MultiVariate Test',
          variationId: '123,456,789',
          variationName: 'Variation2' },
          { context: { integration: { name: 'optimizely', version: '1.0.0' } }
        });
        done();
      });
    });

    it('should send redirect experiment', function(done) {
      window.optimizely.data.state.activeExperiments = [];
      analytics.page();
      tick(function() {
        analytics.called(analytics.track, 'Experiment Viewed', {
          experimentId: 11,
          experimentName: 'Redirect Test',
          variationId: '22',
          variationName: 'Redirect Variation',
          referrer: ''
        }, { context: { integration: { name: 'optimizely', version: '1.0.0' } }
        });
        done();
      });
    });

    it('shouldn\'t send inactive experiments', function(done) {
      tick(function() {
        analytics.didNotCall(analytics.track, 'Experiment Viewed', {
          experimentId: 2,
          experimentName: 'Inactive Test',
          variationId: '44',
          variationName: 'Inactive Variation' },
          { context: { integration: { name: 'optimizely', version: '1.0.0' } }
        });
        done();
      });
    });


    it('should send active experiments with nonInteraction when flagged', function(done) {
      optimizely.options.nonInteraction = true;
      tick(function() {
        analytics.called(analytics.track, 'Experiment Viewed', {
          nonInteraction: 1,
          experimentId: 0,
          experimentName: 'Test',
          variationId: '123',
          variationName: 'Variation1' },
          { context: { integration: { name: 'optimizely', version: '1.0.0' } }
        });
        done();
      });
    });
  });

  describe('after loading', function() {
    beforeEach(function(done) {
      analytics.once('ready', done);
      analytics.initialize();
      mockOptimizelyDataObject();
      analytics.page();
    });

    describe('#track', function() {
      beforeEach(function() {
        analytics.stub(window.optimizely, 'push');
      });

      it('should send an event', function() {
        analytics.track('event');
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {}]);
      });

      it('shouldn\'t send properties it can\'t process', function() {
        analytics.track('event', { property: true });
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {}]);
      });

      it('should change revenue to cents', function() {
        analytics.track('event', { revenue: 9.99 });
        analytics.called(window.optimizely.push, ['trackEvent', 'event', {
          revenue: 999
        }]);
      });
    });

    describe('#page', function() {
      beforeEach(function() {
        analytics.stub(window.optimizely, 'push');
      });

      it('should send an event for a named page', function() {
        analytics.page('Home');
        analytics.called(window.optimizely.push, ['trackEvent', 'Viewed Home Page', {}]);
      });

      it('should send an event for a named and categorized page', function() {
        analytics.page('Blog', 'New Integration');
        analytics.called(window.optimizely.push, ['trackEvent', 'Viewed Blog New Integration Page', {}]);
      });
    });
  });
});
