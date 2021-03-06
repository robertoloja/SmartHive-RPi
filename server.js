// TODO: Web client needs to ask for Hive name.

var express = require('express');
var firebase = require('firebase');
var admin = require('firebase-admin');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient
var assert = require('assert');
var opn = require('opn');
var fs = require('fs');

var serviceAccount = require("./sh.json"); // Downloaded from firebase console
var url = 'mongodb://localhost:27017/sensorData'; // MongoDB URL
var firebaseDB;
var app;

// Apparently, it is a best practice to just keep reusing this connection
MongoClient.connect(url, (err, mongoDB) => {
  assert.equal(null, err);

  // Express server.
  app = express();
  app.use(express.static('public'));
  app.use(bodyParser.urlencoded({extended: false}));
  app.use(bodyParser.json());

  // Serve index page of web client for authentication.
  app.get('/', function (req, res) {
    res.sendFile( __dirname + "/index.html" );
  });

  app.get('/viz', function (req, res) {
    res.sendFile( __dirname + "/public/viz.html" );
  });

  app.get('/weightViz', (req, res) => {
    res.sendFile( __dirname + "/public/weightViz.html" );
  });

  app.get('/popViz', (req, res) => {
    res.sendFile( __dirname + "/public/populationViz.html" );
  });

  // Serve wifi instructions
  app.get('/wifi', function (req, res) {
    res.sendFile( __dirname + "/public/wifi.html" );
  });

  app.get("/data", function(req, res){
    mongoDB.collection('data')
          .find()
          .toArray((err, docs) => {
      assert.equal(null, err);
      
      res.json(docs);
    });
  }); 

  var server = app.listen(3000, function () {
    var host = server.address().address
    var port = server.address().port
    console.log("SmartHive login server listening on port", port)
  });

  /**
    * hiveInfo is a Promise that will contain UID, HID and hiveName.
    * It MUST be used by invoking its then() method, which receives a 
    * callback that has one parameter, in this case an object containing hive 
    * info (uid, hid, hiveName). Anything needing these values HAS to be done 
    * from within that callback, or risk them being undefined.
    *
    * TODO: By the love of God, break this monstrosity up into... modules? 
    *       ...functions? Something smaller and more reusable.
    */
  var hiveInfo = new Promise((resolve, reject) => {
    // get UID from MongoDB, if it exists.
    mongoDB.collection('hiveInfo').find({'uid': /./}).toArray((err, docs) => {
      assert.equal(null, err);

      // This just makes 'docs' easier to deal with.
      if (docs.length == 0)
        docs = {};
      else
        docs = docs[0];

      /**
      * Setup POST receiver, to accept Google UID once user logs in.
      * This has to be a Promise, so it can be resolved when UID is
      * actually needed.
      */
      var uidPromise = new Promise((resolve, reject) => {
        if (docs['uid'] != undefined)
          resolve(docs['uid']);

        app.post('/info', (req, res) => {
          var uid_and_name = {
            'uid': req.body.uid,
            'name': req.body.name
          };
          res.end('POST done');
          resolve(uid_and_name);
        });
      });

      if (docs['uid'] == undefined) { // UID not in MongoDB
        opn('http://localhost:3000'); // open browser

        uidPromise.then((uid) => { // resolved once user logs in
          docs['uid'] = uid['uid'];
          docs['name'] = uid['name'];

          var hive = {
            'name': uid['name'],
            'date_created': Math.round(Date.now() / 1000), // seconds
            'location': '0.0, 0.0'
          };

          connectToFirebase(docs['uid']);
          var ref = firebaseDB.ref('users/' + uid['uid']);
          docs['hid'] = ref.push(hive).key; // This key is the HID.

          delete docs['_id'];
          mongoDB.collection('hiveInfo').insert(docs);
          resolve(docs);
        });
      } else {
        delete docs['_id'];
        connectToFirebase(docs['uid']);
        resolve(docs);
      }
    });
  });

  // This actually cashes out the Promise.
  hiveInfo.then((info) => {
      console.log('Using UID =', info['uid'], ', HID =', info['hid']);
  });


  /**
  * Read data from the MongoDB instance and write any unwritten data to Firebase.
  */
  function getLocalSensorData() {
    var data = mongoDB.collection('data');

    data.find({'uploaded': false}).toArray((err, docs) => {
      assert.equal(null, err);

      if (docs.length == 0)
        return;

      hiveInfo.then((info) => {
        //connectToFirebase(info['uid']);
        var ref = firebaseDB.ref('users/' + info['uid'] +
                                '/' + info['hid'] + '/data');

        for (var i = 0; i < docs.length; i++) {
          data.updateOne({'_id': docs[i]['_id']},
                        {$set: {'uploaded': true}},
                        (err, r) => {
            assert.equal(null, err);
            assert.equal(1, r.matchedCount);
            assert.equal(1, r.modifiedCount);
          });

          delete docs[i]['_id']; // strip Mongo's index from the data.
          delete docs[i]['uploaded']; // strip uploaded field.

          ref.push(docs[i]);
        }
      });
    });
  }


  /**
  * Establish user-limited connection to Firebase. Can only
  * be done once UID has been acquired.
  * @param {String} userID The Google account's Firebase UID.
  */
  function connectToFirebase(userID) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://smarthive-229a5.firebaseio.com",
      databaseAuthVariableOverride: {
        uid: userID
      }
    });
    firebaseDB = admin.database();
  }


  /**
  * Check internet connection.
  * @return {Boolean} true if connected, false otherwise.
  */
  function isOnline() {
    require('dns').resolve('www.google.com', (err) => {
      if (err) {
        console.log("Failed to connect.");
        return false;
      } else {
        console.log("Connection acquired.");
        return true;
      }
    });
  }

  setInterval(getLocalSensorData, 1000);
});
