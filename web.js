// Generated by CoffeeScript 1.3.3
var QuizRoom, app, checkAnswer, crypto, cumsum, express, fs, io, parseCookie, port, questions, rooms, scheduledUpdate, sha1, syllables, updateCache, watcher,
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

express = require('express');

fs = require('fs');

checkAnswer = require('./lib/answerparse').checkAnswer;

syllables = require('./lib/syllable').syllables;

parseCookie = require('express/node_modules/connect').utils.parseCookie;

crypto = require('crypto');

app = express.createServer(express.logger());

io = require('socket.io').listen(app);

app.use(require('less-middleware')({
  src: __dirname
}));

app.use(express.favicon());

app.use(express.cookieParser());

app.use(express.session({
  secret: 'should probably make this more secretive',
  cookie: {
    httpOnly: false
  }
}));

app.use(express["static"](__dirname));

if (app.settings.env === 'development') {
  scheduledUpdate = null;
  updateCache = function() {
    return fs.readFile('offline.appcache', 'utf8', function(err, data) {
      if (err) {
        throw err;
      }
      data = data.replace(/INSERT_DATE.*?\n/, 'INSERT_DATE ' + (new Date).toString() + "\n");
      return fs.writeFile('offline.appcache', data, function(err) {
        if (err) {
          throw err;
        }
        io.sockets.emit('application_update', +(new Date));
        return scheduledUpdate = null;
      });
    });
  };
  watcher = function(event, filename) {
    if (filename === "offline.appcache" || /\.css$/.test(filename)) {
      return;
    }
    console.log("changed file", filename);
    if (!scheduledUpdate) {
      return scheduledUpdate = setTimeout(updateCache, 500);
    }
  };
  fs.watch(__dirname, watcher);
  fs.watch(__dirname + "/lib", watcher);
  fs.watch(__dirname + "/less", watcher);
}

io.configure(function() {
  io.set("log level", 2);
  return io.set("authorization", function(data, fn) {
    var cookie;
    if (!data.headers.cookie) {
      return fn('No cookie header', false);
    }
    cookie = parseCookie(data.headers.cookie);
    if (cookie) {
      console.log("GOT COOKIE", data.headers.cookie);
      data.sessionID = cookie['connect.sid'];
      fn(null, true);
    }
    return fn('No cookie found', false);
  });
});

app.set('views', __dirname);

app.set('view options', {
  layout: false
});

questions = [];

fs.readFile('sample.txt', 'utf8', function(err, data) {
  var line;
  if (err) {
    throw err;
  }
  return questions = (function() {
    var _i, _len, _ref, _results;
    _ref = data.split("\n");
    _results = [];
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      line = _ref[_i];
      _results.push(JSON.parse(line));
    }
    return _results;
  })();
});

cumsum = function(list, rate) {
  var num, sum, _i, _len, _ref, _results;
  sum = 0;
  _ref = [1].concat(list).slice(0, -1);
  _results = [];
  for (_i = 0, _len = _ref.length; _i < _len; _i++) {
    num = _ref[_i];
    _results.push(sum += Math.round(num) * rate);
  }
  return _results;
};

QuizRoom = (function() {

  function QuizRoom(name) {
    this.name = name;
    this.answer_duration = 1000 * 5;
    this.time_offset = 0;
    this.freeze();
    this.new_question();
    this.users = {};
  }

  QuizRoom.prototype.add_socket = function(id, socket) {
    var user;
    if (!(id in this.users)) {
      this.users[id] = {
        sockets: [],
        guesses: 0,
        interrupts: 0,
        early: 0,
        correct: 0,
        last_action: 0
      };
    }
    user = this.users[id];
    user.id = id;
    user.last_action = this.serverTime();
    if (__indexOf.call(user.sockets, socket) < 0) {
      return user.sockets.push(socket);
    }
  };

  QuizRoom.prototype.vote = function(id, action, val) {
    this.users[id][action] = val;
    return this.sync();
  };

  QuizRoom.prototype.touch = function(id) {
    return this.users[id].last_action = this.serverTime();
  };

  QuizRoom.prototype.del_socket = function(id, socket) {
    var sock, user;
    user = this.users[id];
    if (user) {
      return user.sockets = (function() {
        var _i, _len, _ref, _results;
        _ref = user.sockets;
        _results = [];
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          sock = _ref[_i];
          if (sock !== socket) {
            _results.push(sock);
          }
        }
        return _results;
      })();
    }
  };

  QuizRoom.prototype.time = function() {
    if (this.time_freeze) {
      return this.time_freeze;
    } else {
      return this.serverTime() - this.time_offset;
    }
  };

  QuizRoom.prototype.serverTime = function() {
    return +(new Date);
  };

  QuizRoom.prototype.freeze = function() {
    return this.time_freeze = this.time();
  };

  QuizRoom.prototype.unfreeze = function() {
    if (this.time_freeze) {
      this.set_time(this.time_freeze);
      return this.time_freeze = 0;
    }
  };

  QuizRoom.prototype.set_time = function(ts) {
    return this.time_offset = new Date - ts;
  };

  QuizRoom.prototype.pause = function() {
    if (!(this.attempt || this.time() > this.end_time)) {
      return this.freeze();
    }
  };

  QuizRoom.prototype.unpause = function() {
    if (!this.attempt) {
      return this.unfreeze();
    }
  };

  QuizRoom.prototype.timeout = function(metric, time, callback) {
    var diff,
      _this = this;
    diff = time - metric();
    if (diff < 0) {
      return callback();
    } else {
      return setTimeout(function() {
        return _this.timeout(metric, time, callback);
      }, diff);
    }
  };

  QuizRoom.prototype.new_question = function() {
    var question, word;
    this.attempt = null;
    this.begin_time = this.time();
    question = questions[Math.floor(questions.length * Math.random())];
    this.info = {
      category: question.category,
      difficulty: question.difficulty,
      tournament: question.tournament,
      num: question.question_num,
      year: question.year,
      round: question.round
    };
    this.question = question.question.replace(/FTP/g, 'For 10 points').replace(/^\[.*?\]/, '').replace(/\n/g, ' ');
    this.answer = question.answer.replace(/\<\w\w\>/g, '').replace(/\[\w\w\]/g, '');
    this.timing = (function() {
      var _i, _len, _ref, _results;
      _ref = this.question.split(" ");
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        word = _ref[_i];
        _results.push(syllables(word) + 1);
      }
      return _results;
    }).call(this);
    this.rate = Math.round(1000 * 60 / 3 / 300);
    this.cumulative = cumsum(this.timing, this.rate);
    this.end_time = this.begin_time + this.cumulative[this.cumulative.length - 1] + this.answer_duration;
    return this.sync(2);
  };

  QuizRoom.prototype.skip = function() {
    return this.new_question();
  };

  QuizRoom.prototype.emit = function(name, data) {
    return io.sockets["in"](this.name).emit(name, data);
  };

  QuizRoom.prototype.end_buzz = function(session) {
    var _ref;
    if (((_ref = this.attempt) != null ? _ref.session : void 0) === session) {
      this.touch(this.attempt.user);
      this.attempt.final = true;
      this.attempt.correct = checkAnswer(this.attempt.text, this.answer);
      this.sync();
      this.unfreeze();
      if (this.attempt.correct) {
        this.users[this.attempt.user].correct++;
        if (this.attempt.early) {
          this.users[this.attempt.user].early++;
        }
        this.set_time(this.end_time);
      } else if (this.attempt.interrupt) {
        this.users[this.attempt.user].interrupts++;
      }
      this.attempt = null;
      return this.sync(1);
    }
  };

  QuizRoom.prototype.buzz = function(user) {
    var early_index, session,
      _this = this;
    this.touch(user);
    if (this.attempt === null && this.time() <= this.end_time) {
      session = Math.random().toString(36).slice(2);
      early_index = this.question.replace(/[^ \*]/g, '').indexOf('*');
      this.attempt = {
        user: user,
        realTime: this.serverTime(),
        start: this.time(),
        duration: 8 * 1000,
        session: session,
        text: '',
        early: early_index && this.time() < this.begin_time + this.cumulative[early_index],
        interrupt: this.time() < this.end_time - this.answer_duration,
        final: false
      };
      this.users[user].guesses++;
      this.freeze();
      this.sync(1);
      return this.timeout(this.serverTime, this.attempt.realTime + this.attempt.duration, function() {
        return _this.end_buzz(session);
      });
    }
  };

  QuizRoom.prototype.guess = function(user, data) {
    var _ref;
    this.touch(user);
    if (((_ref = this.attempt) != null ? _ref.user : void 0) === user) {
      this.attempt.text = data.text;
      if (data.final) {
        console.log('omg final clubs are so cool ~ zuck');
        return this.end_buzz(this.attempt.session);
      } else {
        return this.sync();
      }
    }
  };

  QuizRoom.prototype.sync = function(level) {
    var action, actionvotes, attr, blacklist, data, id, nay, user, user_blacklist, vote, voting, yay, _i, _len;
    if (level == null) {
      level = 0;
    }
    data = {
      real_time: +(new Date),
      voting: {}
    };
    voting = ['skip', 'pause', 'unpause'];
    for (_i = 0, _len = voting.length; _i < _len; _i++) {
      action = voting[_i];
      yay = 0;
      nay = 0;
      actionvotes = [];
      for (id in this.users) {
        vote = this.users[id][action];
        if (vote === 'yay') {
          yay++;
          actionvotes.push(id);
        } else {
          nay++;
        }
      }
      if (actionvotes.length > 0) {
        data.voting[action] = actionvotes;
      }
      if (yay / (yay + nay) > 0) {
        for (id in this.users) {
          delete this.users[id][action];
        }
        this[action]();
      }
    }
    blacklist = ["name", "question", "answer", "timing", "voting", "info", "cumulative", "users"];
    user_blacklist = ["sockets"];
    for (attr in this) {
      if (typeof this[attr] !== 'function' && __indexOf.call(blacklist, attr) < 0) {
        data[attr] = this[attr];
      }
    }
    if (level >= 1) {
      data.users = (function() {
        var _results;
        _results = [];
        for (id in this.users) {
          user = {};
          for (attr in this.users[id]) {
            if (__indexOf.call(user_blacklist, attr) < 0) {
              user[attr] = this.users[id][attr];
            }
          }
          user.online = this.users[id].sockets.length > 0;
          _results.push(user);
        }
        return _results;
      }).call(this);
    }
    if (level >= 2) {
      data.question = this.question;
      data.answer = this.answer;
      data.timing = this.timing;
      data.info = this.info;
    }
    return io.sockets["in"](this.name).emit('sync', data);
  };

  return QuizRoom;

})();

sha1 = function(text) {
  var hash;
  hash = crypto.createHash('sha1');
  hash.update(text);
  return hash.digest('hex');
};

rooms = {};

io.sockets.on('connection', function(sock) {
  var publicID, room, sessionID,
    _this = this;
  sessionID = sock.handshake.sessionID;
  publicID = null;
  room = null;
  sock.on('join', function(data, fn) {
    var room_name;
    if (data.old_socket && io.sockets.socket(data.old_socket)) {
      io.sockets.socket(data.old_socket).disconnect();
    }
    room_name = data.room_name;
    publicID = sha1(sessionID + room_name);
    sock.join(room_name);
    if (!(room_name in rooms)) {
      rooms[room_name] = new QuizRoom(room_name);
    }
    room = rooms[room_name];
    room.add_socket(publicID, sock.id);
    if (!('name' in room.users[publicID])) {
      room.users[publicID].name = require('./lib/names').generateName();
    }
    fn({
      id: publicID,
      name: room.users[publicID].name
    });
    room.sync(2);
    return room.emit('introduce', {
      user: publicID
    });
  });
  sock.on('echo', function(data, callback) {
    return callback(+(new Date));
  });
  sock.on('rename', function(name) {
    room.users[publicID].name = name;
    room.touch(publicID);
    if (room) {
      return room.sync(1);
    }
  });
  sock.on('skip', function(vote) {
    return room.vote(publicID, 'skip', vote);
  });
  sock.on('pause', function(vote) {
    return room.vote(publicID, 'pause', vote);
  });
  sock.on('unpause', function(vote) {
    return room.vote(publicID, 'unpause', vote);
  });
  sock.on('buzz', function(data, fn) {
    if (room) {
      return room.buzz(publicID, fn);
    }
  });
  sock.on('guess', function(data) {
    if (room) {
      return room.guess(publicID, data);
    }
  });
  sock.on('chat', function(_arg) {
    var final, session, text;
    text = _arg.text, final = _arg.final, session = _arg.session;
    if (room) {
      room.touch(publicID);
      return room.emit('chat', {
        text: text,
        session: session,
        user: publicID,
        final: final,
        time: room.serverTime()
      });
    }
  });
  return sock.on('disconnect', function() {
    console.log("someone", publicID, sock.id, "left");
    if (room) {
      room.del_socket(publicID, sock.id);
      room.sync(1);
      if (room.users[publicID].sockets.length === 0) {
        return room.emit('leave', {
          user: publicID
        });
      }
    }
  });
});

app.get('/:channel', function(req, res) {
  var name;
  name = req.params.channel;
  return res.render('index.jade', {
    name: name,
    env: app.settings.env
  });
});

app.get('/', function(req, res) {
  return res.redirect('/' + require('./lib/names').generatePage());
});

port = process.env.PORT || 5000;

app.listen(port, function() {
  return console.log("listening on", port);
});
