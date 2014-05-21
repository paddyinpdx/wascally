var _ = require( 'lodash' ),
	when = require( 'when' ),
	pipeline = require( 'when/pipeline' );

module.exports = function( Broker, log ) {

	var Channel = function( model ) {
		this.model = model;
		this.pendingMessages = [];
		this.debuffering = false;
		this.lastAck = -1;
		this.lastNack = -1;

		_.bindAll( this );
	};

	Channel.prototype.betterAck = function( tag, inclusive ) {
		return when.promise( function( resolve, reject ) {
			this.lastAck = tag;
			this.setResult( tag, 'ack', inclusive );
			resolve();
		}.bind( this ) );
	};

	Channel.prototype.betterNack = function( tag, inclusive ) {
		return when.promise( function( resolve, reject ) {
			this.lastNack = tag;
			this.setResult( tag, 'nack', inclusive );
			resolve();
		}.bind( this ) );
	};

	Channel.prototype.betterAckAll = function() {
		return when.promise( function( resolve, reject ) {
			this.lastAck = _.findLast( this.pendingMessages, function( message ) {
				return message.result === 'ack';
			} ).tag;
			_.remove( this.pendingMessages, function( message ) {
				return message.result === 'ack';
			} );
			this.model.ackAll();
			resolve();
		}.bind( this ) );
	};

	Channel.prototype.betterNackAll = function() {
		return when.promise( function( resolve, reject ) {
			this.lastNack = _.findLast( this.pendingMessages, function( message ) {
				return message.result === 'nack';
			} ).tag;
			_.remove( this.pendingMessages, function( message ) {
				return message.result === 'nack';
			} );
			this.model.nackAll();
			resolve();
		} );
	};

	Channel.prototype.setResult = function( tag, result, inclusive ) {
		var i = _.findIndex( this.pendingMessages, {
			'tag': tag
		} );

		_.remove( this.pendingMessages, function( message ) {
			return message.tag <= tag;
		} );

		switch ( result ) {
			case 'ack':
				this.model.ack( {
					fields: {
						deliveryTag: tag
					}
				}, inclusive );
				break;
			case 'nack':
				this.model.nack( {
					fields: {
						deliveryTag: tag
					}
				}, inclusive );
				break;
		}
	};

	Broker.prototype.getChannel = function( name, connectionName, confirm ) {
		connectionName = connectionName || 'default';
		var method = confirm ? 'createConfirmChannel' : 'createChannel';
		return when.promise( function( resolve, reject ) {
			var connection,
				onConnection = function( instance ) {
						connection = instance;
						var handle = connection.handle,
							channel = connection.channels[ name ];
						if ( channel ) {
							resolve( channel );
						} else if ( handle ) {
							handle[ method ]()
								.then( onChannel )
								.then( null, channelFailed );
						}
					}.bind( this ),
				onChannel = function( instance ) {
						var channel = new Channel( instance );
						connection.channels[ name ] = channel;
						resolve( channel );
						this.emit( 'channel.' + name + '.created', channel );
					}.bind( this ),
				channelFailed = function( err ) {
						this.emit( 'errorLogged' );
						this.log.log('error', {
							error: err,
							reason: 'Could not create channel "' + name + '" on connection "' + connectionName + '"'
						} );
						reject( err );
					}.bind( this ),
				connectionFailed = function( err ) {
						this.emit( 'errorLogged' );
						this.log.log('error', {
							error: err,
							reason: 'Could acquire connection "' + connectionName + '" trying to create channel "' + name + '"'
						} );
						reject( err );
					}.bind( this );

			this.getConnection( connectionName )
				.then( onConnection )
				.then( null, connectionFailed );
		}.bind( this ) );
	};
};