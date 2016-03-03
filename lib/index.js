
/**
 * Module dependencies.
 */

var each = require('each');
var foldl = require('foldl');
var integration = require('analytics.js-integration');
var push = require('global-queue')('optimizely');
var tick = require('next-tick');

/**
 * Expose `Optimizely` integration.
 */

var Optimizely = module.exports = integration('Optimizely')
  .option('listen', false)
  .option('trackCategorizedPages', true)
  .option('trackNamedPages', true)
  .option('variations', true)
  .option('nonInteraction', false);

/**
 * The name and version for this integration.
 */

var integrationContext = {
  name: 'optimizely',
  version: '1.0.0'
};

/**
 * Initialize.
 *
 * https://www.optimizely.com/docs/api#function-calls
 *
 * @api public
 */

Optimizely.prototype.initialize = function() {
  var self = this;
  if (this.options.variations) {
    tick(function() {
      self.replay();
    });
  }
  if (this.options.listen) {
    tick(function() {
      self.roots();
    });
  }
  this.ready();
};

/**
 * Track. trackEvent can only send one property, revenue
 * We fall back to total if it's on the call and revenue is not
 *
 * https://www.optimizely.com/docs/api#track-event
 * http://developers.optimizely.com/javascript/reference/#api-function-calls
 *
 * @api public
 * @param {Track} track
 */

Optimizely.prototype.track = function(track) {
  var props = track.properties();
  var payload = {};
  var revenue = props.revenue || props.total || props.value;
  if (revenue) payload.revenue = revenue *= 100;
  push('trackEvent', track.event(), payload);
};

/**
 * Page.
 *
 * https://www.optimizely.com/docs/api#track-event
 *
 * @api public
 * @param {Page} page
 */

Optimizely.prototype.page = function(page) {
  var category = page.category();
  var name = page.fullName();
  var opts = this.options;

  // categorized pages
  if (category && opts.trackCategorizedPages) {
    this.track(page.track(category));
  }

  // named pages
  if (name && opts.trackNamedPages) {
    this.track(page.track(name));
  }
};

/**
 * Send experiment data as track events to Segment
 *
 * https://www.optimizely.com/docs/api#data-object
 *
 * @api private
 */

Optimizely.prototype.roots = function() {
  var self = this;
  // FIXME: Under what conditions does this happen? Sounds like we should fix
  // our #loaded method?
  // http://developers.optimizely.com/integrations/#write-the-integration-code
  // In case the snippet isn't on the page
  if (!window.optimizely || !window.optimizely.data) return;

  var data = window.optimizely.data;
  var allExperiments = data.experiments;

  if (!data || !data.state || !allExperiments) return;

  var activeExperiments = getExperiments({
    variationNamesMap: data.state.variationNamesMap,
    variationIdsMap: data.state.variationIdsMap,
    activeExperimentIds: data.state.activeExperiments,
    sections: data.sections,
    allExperiments: allExperiments
  });

  var redirectExperiment = data.state.redirectExperiment;
  if (redirectExperiment) {
    var id = redirectExperiment.experimentId;
    var variationId = redirectExperiment.variationId;
    var referrer = redirectExperiment.referrer;

    // Make sure it's not already already accounted for
    if (data.state.activeExperiments.indexOf(id) === -1) {
      activeExperiments.push({
        variationId: variationId,
        experimentId: id,
        referrer: referrer
      });
    }
  }

  each(activeExperiments, function(props) {
    // make sure the event is labelled as nonInteraction for GA
    if (self.options.nonInteraction) props.nonInteraction = 1;
    self.analytics.track(
      'Experiment Viewed',
      props,
      { context: { integration: integrationContext } }
    );
  });
};

/**
 * Replay experiment data as traits to other enabled providers.
 *
 * https://www.optimizely.com/docs/api#data-object
 *
 * @api private
 */

Optimizely.prototype.replay = function() {
  // In case the snippet isn't on the page
  //
  // FIXME: Under what conditions does this happen? Sounds like we should fix
  // our #loaded method?
  if (!window.optimizely) return;

  var data = window.optimizely.data;
  if (!data || !data.experiments || !data.state) return;

  var traits = foldl(function(traits, variation, experimentId) {
    var experiment = data.experiments[experimentId].name;
    traits['Experiment: ' + experiment] = variation;
    return traits;
  }, {}, data.state.variationNamesMap);

  this.analytics.identify(traits);
};

/**
 * Retrieves active experiments.
 *
 * @api private
 * @param {Object} options
 */

function getExperiments(options) {
  return foldl(function(results, experimentId, index) {
    var experiment = options.allExperiments[experimentId];
    var multiVariate = options.sections[experimentId];
    if (experiment) {
      results.push({
        variationName: options.variationNamesMap[experimentId],
        variationId: options.variationIdsMap[experimentId][0],
        experimentId: experimentId,
        experimentName: experiment.name
      });
      if (multiVariate) {
        results[index].sectionName = multiVariate.name;
        results[index].variationId = multiVariate.variation_ids.join();
      }
    }
    return results;
  }, [], options.activeExperimentIds);
}
