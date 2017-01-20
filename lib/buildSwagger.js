var _ = require('lodash');
var async = require('async');
var fs = require('fs');
var path = require('path');
var doctrine = require('doctrine');
var yaml = require('js-yaml');


// If this needs to be refactored for future version of
// the jsdocs or swagger, you might consider switching
// to https://github.com/Surnet/swagger-jsdoc for the 
// inline doc parsing.

module.exports = function(apiEntries, callback){
  // Make sure we reject data types that are neither strings nor arrays
  // Either way, make sure apiEntries becomes an array.
  if (_.isString(apiEntries) || _.isArray(apiEntries)){
    apiEntries = _.flatten([apiEntries]);
  }
  else {
    var e = new Error();
    e.message('You must supply a string or an array of strings');
    return callback(e);
  }

  var parseResults = {
    success: [],
    fail: []
  };

  async.each(apiEntries, function(oneFile, next){

    async.auto({
      // Open each file supplied in the array of filenames
      // and parse each comment block that begins with "@swagger"
      // into an array of strings.
      'getDocsFromFile': function(next){
        fs.readFile(oneFile, function (err, data) {
          if (err) {
            return next(null, {
              file: oneFile,
              error: err,
              parsedFrags: []
            });
          }

          var js = data.toString();
          var regex = /\/\*\*([\s\S]*?)\*\//gm;
          var fragments = js.match(regex);

          var parsedFrags = _.reduce(fragments,function(keepers, oneFragment){
            if (oneFragment){
              var oneParsedFrag = doctrine.parse(oneFragment, { unwrap: true });
              var swaggerTags = _.filter(oneParsedFrag.tags, {title: 'swagger'});
              if (swaggerTags.length){
                oneParsedFrag.tags = swaggerTags;
                keepers.push(oneParsedFrag);
              }
            }
            return keepers;
          },[]);

          return next(null,{
            file: oneFile,
            parsedFrags: parsedFrags
          });
        });

      },

      // Convert the string snippets into a collection
      // of YAML structured JSON objects.
      'convertDocsToYaml': ['getDocsFromFile',function(results, next){

        var parsedFrags = results.getDocsFromFile.parsedFrags;
        if (!parsedFrags.length){
          return next();
        }

        async.reduce(parsedFrags, [], function(keepers, oneFragment, next) {

          async.map(oneFragment.tags, function(oneTag, next){
            var useYamlTag;
            try {
              yaml.safeLoadAll(oneTag.description, function(yamlTag){
                if (yamlTag){
                  useYamlTag = yamlTag;
                }
              });
            }
            catch (yamlErr){
              console.log('Error safe loading:',yamlErr);
              return next();
            }
            return next(null,useYamlTag);
          }, function(err, swaggerYamlTags) {

            if (swaggerYamlTags&&swaggerYamlTags.length){
              oneFragment.tags = swaggerYamlTags;
              keepers.push(oneFragment);
            }

            return next(null,keepers);
          });

        }, function(err, swaggerizedApiObjects) {

          return next(null,swaggerizedApiObjects);
        });

      }]
    }, function(err, results){
      // Recombine the YAML-ized objects with the filename
      // from which they came.  Also handle errors.
      if (results.getDocsFromFile.error || results.convertDocsToYaml && results.convertDocsToYaml.error){
        parseResults.fail.push({
          file: results.getDocsFromFile.file,
          err: results.getDocsFromFile.error || results.convertDocsToYaml.error
        });
      }

      if (results.convertDocsToYaml&&results.convertDocsToYaml.length){
        parseResults.success.push({
          file: results.getDocsFromFile.file,
          docs: results.convertDocsToYaml
        });
      }

      else {
        parseResults.fail.push({
          file: results.getDocsFromFile.file,
          err: 'No swagger comments in file'
        });
      }

      return next();

    });

  }, function(err){

    // Take the collection of YAML objects and combine
    // the, into a giant array that is structured in the
    // way the swagger-ui front end expects it.
    //
    // In the future if we want to add support for other
    // types of swagger objects, we can do that here.

    var flattenedResults = _.compact(_.map(_.flatten(_.map(parseResults.success, 'docs')), 'tags'));
    flattenedResults = _.reduce(flattenedResults,function(keepers,oneResult){
      oneResult = oneResult[0];
      var pathName = _.keys(oneResult)[0];
      keepers[pathName] = oneResult[pathName];
      return keepers;
    },{})
    return callback(null, {
      paths: flattenedResults
    });

  });

}