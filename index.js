/**
 * Swagger hook
 *
 * @description :: functionality for Swagger-ui integration.  Also routes and serves assets for swagger-ui endpoints.
 * @docs        :: http://sailsjs.com/docs/concepts/extending-sails/hooks
 */

var path = require('path');
var fs = require('fs');
var async = require('async');
var _ = require('lodash');
var static = require('serve-static');

var buildSwagger = require('./lib/buildSwagger.js');

module.exports = function defineSwaggerHook(sails) {

  var serveStatic;
  var swaggerJSON;

  var hook = {
    build: buildSwagger,
    defaults: {
      swagger: {
        uiconfig: {
          swagger: '2.0',
          info: {
            version: '1.0.0',
            title: 'Sample spec',
            description: 'Sample spec for Swagger',
            termsOfService: 'http://swagger.io/terms/'
          },
          basePath: '/',
          tags: [
          ],
          schemes: [
            'http'
          ],
          consumes: [
            'application/json'
          ],
          produces: [
            'application/json'
          ],
          paths: {},
          definitions: {}
        }
      }
    },
    routes: {
      before: {
        // If the swaggerui config specifies a policy
        // by which to protect the swagger endpoints,
        // do so.  Otherwise, do nothing.
        '/swagger*': function(req, res, next){
          if (sails.config.swaggerui && sails.config.swaggerui.protectedBy){
            var policyMiddleware = sails.middleware.policies[sails.config.swaggerui.protectedBy.toLowerCase()];
            return policyMiddleware.call(this, req, res, next);
          }
          return next();
        }
      },
      after: {

        // Serve the automatically generated swagger JSON
        // for consumption by swagger-ui
        '/swagger/discover/': function(req, res, next){
          if (swaggerJSON){
            return res.json(swaggerJSON);
          }
          return next();
        },

        // Serve the main swagger-ui view after injecting
        // it with the csrf token.
        '/swagger/': function(req, res, next){

          fs.readFile(path.join(__dirname, '/assets/swagger/index.html'), 'utf-8', function (err, html) {
            if (err) {
              throw err; 
            }

            html = _.template(html)({csrf:(res.locals && res.locals._csrf)});

            res.status(200);
            res.set('Content-Type', 'text/html');
            res.send(new Buffer(html));
            return res.end();
          });
        },

        // Redirect to the above middleware function in
        // the event that the trailing slash is omitted.
        '/swagger': function(req, res, next){
          return res.redirect('/swagger/')
        },

        // Serve all other swagger-ui assets
        '/swagger*': function(req, res, next){
          if (serveStatic){
            return serveStatic(req, res, next);
          }
          return next();
        }
      }
    }
  };

  /**
   * Runs before any hooks initialize but after
   * all config has been loaded and merged.
   *
   * @param {Function} done
   */
  hook.configure = function(){

  };

  /**
   * Runs when the Sails app loads/lifts.
   *
   * @param {Function} done
   */
  hook.initialize = function(done) {

    sails.log.debug('Initializing custom hook (`swagger`)');

    // After Sails sets up the middleware stack and binds
    // the appropriate policies, generate the swagger-ui
    // json object from our inline controller/model comments.
    sails.after(['router:after'], function(){

      // Return an array of full filename of all javascript files
      // 
      // If we want to add swagger-ui support for `hooks` or models
      // in the future, this should be turned into an async.each 
      // block that iterates over the base path of the respective
      // component directories (i.e. ./api/hooks)
      // 
      // If we want to do it properly, we should pull this information
      // directly from the sails object rather than trying to get
      // it from the filesystem.  This will make it more reliable
      // as well as future proof
      fs.readdir('./api/controllers', function(err, files){
        swaggerAssetFiles = _.reduce(files,function(keepers,oneFileName){
          if ((/\.js$/i).test(oneFileName)){
            keepers.push(path.join(process.env.PWD, 'api/controllers/'+oneFileName));
          }
          return keepers;
        },[]);

        // Create swagger `tags` from the different parts of
        // the sails project.
        _.extend(sails.config.swagger.uiconfig.tags, _.map(swaggerAssetFiles, function(oneAssetFile){

          var assetType;
          var externalDoc;
          var filename = oneAssetFile.split('/').pop().split('.js')[0];

          if (oneAssetFile.indexOf('/api/controllers/') > -1){
            assetType = 'Controller';
            externalDoc = 'https://sailsjs.com/documentation/concepts/controllers';
          }
          else if (oneAssetFile.indexOf('/api/models/') > -1){
            assetType = 'Model';
            externalDoc = 'https://sailsjs.com/documentation/concepts/models-and-orm/models';
          }
          else if (oneAssetFile.indexOf('/api/hooks/') > -1){
            assetType = 'Hook';
            externalDoc = 'https://sailsjs.com/documentation/concepts/extending-sails/hooks';
          }
          else {
            assetType = 'Other';
            externalDoc = 'https://sailsjs.com/documentation/concepts';
          }

          return {
            name: filename,
            description: 'API functionality related to the '+filename+' '+assetType,
            externalDoc: externalDoc
          }
          
        }));

        // Call the function that parses inline docs into swagger-ui json
        hook.build(swaggerAssetFiles, function(err, swaggerData){
          if (err){
            console.log('Error building JSON for swagger-ui:', err);
            return;
          }
          swaggerJSON = _.cloneDeep(sails.config.swagger.uiconfig);

          _.extend(swaggerJSON, {
            paths: swaggerData.paths
          });

          serveStatic = static(path.join(__dirname, 'assets'));

        });

      });
    });

    return done();
  };

  return hook;

};
