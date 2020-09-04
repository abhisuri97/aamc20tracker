const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
var Twitter = require('twitter');
const bodyParser = require('body-parser')
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/aamc-tracker', { useNewUrlParser: true, useUnifiedTopology: true });

var app = express();
app.engine('html', require('ejs').__express)
app.set('view engine', 'html')
app.use('/static', express.static(path.join(__dirname, 'static')))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

var TranscriptEntrySchema = new mongoose.Schema({
  username: 'string',
  ts_name: 'string',
  ts_type: 'string',
  ts_sent: 'number',
  ts_received: 'number',
})
var ApplicationEntrySchema = new mongoose.Schema({
  username: 'string',
  app_submit: 'number',
  app_verified: 'number',
})

var TwitterTrackerSchema = new mongoose.Schema({
  last_pull_id: 'number',
  last_pull_tw_ts: 'number',
  last_pull_ts: 'number'
})
var TranscriptEntry = mongoose.model('TranscriptEntry', TranscriptEntrySchema);
var ApplicationEntry = mongoose.model('ApplicationEntry', ApplicationEntrySchema);
var TwitterTracker = mongoose.model('TwitterTracker', TwitterTrackerSchema);



//////
//
// set up twitter api //
// //


var client = new Twitter ({
    consumer_key: 'FILL THIS IN',
    consumer_secret: 'FILL THIS IN',
    access_token_key: 'FILL THIS IN',
    access_token_secret: 'FILL THIS IN'
})

var months = ['January', 'Februrary', 'March', 'April', 'May', 'June', 'July', 'August',
              'September', 'October', 'November', 'December'];
// AMCAS ID is 262318182

var tryAndPull = function() {
  TwitterTracker.find({}, function(err, resp) {
    console.log(resp.length);
    var params = { screen_name: 'AMCASinfo', 
      include_rts: true, 
      count: 10000,
      exclude_replies: true,
      trim_user: true,
    };
    if (resp.length == 0) {
      getTweets(params, null, function(res, tw) {
        if (res == 'done') {
          console.log(tw.id);
          var t = new TwitterTracker({
           last_pull_id: tw.id,
           last_pull_tw_ts: Date.parse(tw.created_at),
           last_pull_ts: +Date.now()
          })
          t.save();
        }
      });
    } else {
      if (Date.now() - resp[0].last_pull_ts > 3600000) {
        getTweets(params, null, function(res, tw) {
          if (res == 'done') {
            console.log(tw.id);
            resp[0].last_pull_id = tw.id;
            resp[0].last_pull_tw_ts = +Date.parse(tw.created_at);
            resp[0].last_pull_ts = +Date.now()
            resp[0].save()
            console.log('PULL ATTEMPTED');
          }
        }, resp[0].last_pull_tw_ts)
      }
    }
  })
}

function getTweets(params, sinceId, cb, minTime=1590537600000) {
  console.log('called');
  client.get('statuses/user_timeline', params, function(error, tweets, response) {
    if (!error) {
      tweets = tweets.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      if (!sinceId) {
        sinceId = tweets[0]
      }
      if (Date.parse(tweets[0].created_at) > minTime) {
        processTweets(tweets);
        var lastId = tweets[tweets.length -1].id
        var params2 = {
          ...params, max_id: lastId
        }
        getTweets(params2, sinceId, cb, minTime);
      } else {
        console.log('TOO OLD! ' + tweets[0].created_at)
        cb('done', sinceId)
      }
    } else {
      console.log(error)
    }
  })
}

function processTweets(tweets) {
  console.log('LAST TWEET: ' + tweets[tweets.length-1].created_at)
  tweets.forEach(i => {
    if (i.text.indexOf('processing applications that reached') > -1) {
      //minMonth = '';
      //minIdx = -1;
      var strIdx = months.reduce((acc, c) => {
        if (i.text.indexOf(c) > -1 && acc[0] == -1) {
          return [i.text.indexOf(c), c] 
        }
        return acc;
      }, [-1, ''])
      var dateNum = ''
      if (strIdx[0] > -1) {
        dateNum = i.text.split(strIdx[1] + ' ')[1].replace(/(^\d+)(.+$)/i,'$1');
      }
      if (dateNum.length > 0) {
        var finalDate = `${strIdx[1].substring(0, 3)} ${dateNum} 2020 9:00 AM EST`
        var obj = {
          username: 'AMCASOFFICIAL_' + i.id,
          submit: Date.parse(finalDate)/1000,
          verified: Date.parse(i.created_at)/1000,
        }
        ApplicationEntry.deleteMany({ username: obj.username }, function(err2) {
          if (err2) console.log('Error in removing app entries' + err2);
          ApplicationEntry.insertMany([
            { username: obj.username, app_submit: obj.submit, app_verified: obj.verified }
          ], function(err4) {
            if (err4) console.log('Error in adding application');
            //console.log('Added ' + obj.username, new Date(obj.verified*1000).toString());
          })
        })
        //console.log(i.id, i.created_at, i.text, Date.parse(finalDate));
      }
    }
  })

}

tryAndPull();

app.use('/static', express.static(path.join(__dirname, 'static')))

app.get('/', (req, res) => {
  tryAndPull();
  TwitterTracker.find({}, function(err, resp) {
    if (err) { 
      return res.render('index', { lastPull: null })
    } else {
      return res.render('index', { lastPull: resp[0].last_pull_ts });
    }
  })
})

app.get('/getData', (req, res) => {
  TranscriptEntry.find({}, function(err, tss) {
    if (err) res.send('error');
    var obj = {}
    var tssClean = tss.map(i => { 
      obj[i.username] = obj[i.username] ? (i.ts_received > obj[i.username] ? i.ts_received : obj[i.username]) : i.ts_received 
      return { sent: i.ts_sent, received: i.ts_received, type: i.ts_type }
    })
    ApplicationEntry.find({}, function(err2, apps) {
      if (err2) res.send('error');
      var appsClean = apps.map(i => {
        return {
          oldData: i.username.indexOf('2019sdn') > -1,
          official: i.username.indexOf('AMCASOFFICIAL') > -1,
          submit: obj[i.username] ? (obj[i.username] > i.app_submit ? obj[i.username] : i.app_submit) : i.app_submit,
          verified: i.app_verified
        }
      })
      res.send(JSON.stringify({ transcripts: tssClean, applications: appsClean }))
    })
  })
})
app.get('/findUser/:username', (req, res) => {
  var username = req.params.username;
  TranscriptEntry.find({ username: username }, function(err, objs) {
    if (err) res.send('error');
    if (!err) {
      ApplicationEntry.findOne({ username: username }, function(err2, obj2) {
        if (err2) res.send('error');
        if (!obj2) {
          var obj2 = {}
          obj2.app_submit = null;
          obj2.app_verified = null;
        }
        var resp = {
          username: username,
          submit: obj2.app_submit,
          verified: obj2.app_verified,
          transcripts: objs.map(i => {
            return {
              name: i.ts_name,
              type: i.ts_type,
              sent: i.ts_sent,
              received: i.ts_received
            }
          })
        }
        res.send(JSON.stringify(resp));
      })
    }
  })
})

app.post('/updateInfo', (req, res) => {
  var obj = JSON.parse(Object.keys(req.body)[0])
  console.log(obj);
  // create need to implement find
  TranscriptEntry.deleteMany({ username: obj.username }, function(err) {
    if (err) console.log('Error in removing transcripts: ' + err);
    var tss = obj.transcripts.map((i) => {return { 
      username: obj.username, 
      ts_name: i.name, 
      ts_type: i.type,
      ts_sent: i.sent,
      ts_received: i.received
    }});
    TranscriptEntry.insertMany(tss, function(err2) {
      if (err2) console.log(err2);
      console.log('successfully deleted and added entries for ' + obj.username);
      ApplicationEntry.deleteMany({ username: obj.username }, function(err3) {
        if (err3) console.log('Error in removing app entries' + err);
        ApplicationEntry.insertMany([
          { username: obj.username, app_submit: obj.submit, app_verified: obj.verified }
        ], function(err4) {
          if (err4) console.log('Error in adding application');
          res.send('success');
        })
      })
    })
  })
  return 'success'
})

app.listen(process.env.PORT || 3000, () => {
  console.log('App listening on port ' + (process.env.PORT || 3000));
})
