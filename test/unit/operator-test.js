import { ok, equal, deepEqual } from 'assert'
import operator from '../../src/operator'
import mockio from '../mock-io'
import { tick } from '../tick'
import { parallel } from 'async'
import { map, includes } from 'lodash/collection'

const debug = require( 'debug' )( 'happychat:test:operators' )

describe( 'Operators', () => {
	let operators
	let socketid = 'socket-id'
	let user
	let socket, client, server

	const connectOperator = ( { socket: useSocket, client: useClient }, authUser = { id: 'user-id', displayName: 'name' } ) => new Promise( ( resolve ) => {
		useClient.on( 'identify', ( identify ) => identify( authUser ) )
		operators.once( 'connection', ( _, callback ) => callback( null, authUser ) )
		useClient.once( 'init', ( clientUser ) => {
			useClient.emit( 'status', clientUser.status || 'online', () => resolve( { user: clientUser, client: useClient, socket: useSocket } ) )
		} )
		server.connect( useSocket )
	} )

	beforeEach( () => {
		( { socket, client, server } = mockio( socketid ) )
		operators = operator( server )
	} )

	describe( 'when authenticated and online', () => {
		let op = { id: 'user-id', displayName: 'furiosa', avatarURL: 'url', priv: 'var', status: 'online' }
		beforeEach( ( done ) => {
			connectOperator( { socket, client }, op )
			.then( ( { user: operatorUser } ) => {
				user = operatorUser
				done()
			} )
		} )

		it( 'should recover chats for an operator', ( done ) => {
			operators.emit( 'recover', { user: op }, [ { id: 'something' } ], tick( () => {
				equal( operators.io.rooms['customers/something'].length, 1 )
				done()
			} ) )
		} )

		it( 'should emit disconnect event when last operator socket disconnects', ( done ) => {
			operators.on( 'disconnect', tick( ( { id } ) => {
				equal( id, op.id )
				done()
			} ) )
			server.disconnect( { socket, client } )
		} )

		it( 'should emit message', ( done ) => {
			operators.on( 'message', ( { id: chat_id }, { id, displayName, avatarURL, priv }, { text, user: author } ) => {
				ok( id )
				ok( displayName )
				ok( avatarURL )
				ok( priv )
				ok( ! author.priv )
				equal( chat_id, 'chat-id' )
				equal( text, 'message' )
				done()
			} )
			client.emit( 'message', 'chat-id', { id: 'message-id', text: 'message' } )
		} )

		it( 'should handle `chat.typing` from client and pass to events', ( done ) => {
			operators.on( 'typing', ( chat, user, text ) => {
				equal( chat.id, 'chat-id' )
				equal( user.id, op.id )
				equal( text, 'typing a message...' )
				done()
			} )

			client.emit( 'chat.typing', 'chat-id', 'typing a message...' );
		} )

		it( 'should emit when user wants to join a chat', ( done ) => {
			operators.on( 'chat.join', ( chat_id, clientUser ) => {
				equal( chat_id, 'chat-id' )
				deepEqual( clientUser, user )
				done()
			} )
			client.emit( 'chat.join', 'chat-id' )
		} )

		it( 'should emit when user wants to leave a chat', ( done ) => {
			operators.on( 'chat.leave', ( chat_id, clientUser ) => {
				equal( chat_id, 'chat-id' )
				deepEqual( clientUser, user )
				done()
			} )
			client.emit( 'chat.leave', 'chat-id' )
		} )

		it( 'should assign an operator to a new chat', ( done ) => {
			// set up a second client
			const connection = server.newClient()
			const { client: clientb } = connection
			connectOperator( connection, user )
			.then( ( userb ) => {
				let a_open = false, b_open = false;
				client.on( 'chat.open', () => {
					a_open = true
				} )
				clientb.on( 'chat.open', () => {
					b_open = true
				} )

				client.on( 'available', ( chat, callback ) => {
					equal( chat.id, 'chat-id' )
					callback( { load: 5, capacity: 6, id: user.id } )
				} )
				clientb.on( 'available', ( chat, callback ) => {
					callback( { load: 5, capacity: 5, id: userb.id } )
				} )
				operators.emit( 'assign', { id: 'chat-id' }, 'customer/room-name', tick( ( error, assigned ) => {
					ok( ! error )
					ok( a_open )
					ok( b_open )
					equal( assigned.id, 'user-id' )
					ok( includes( socket.rooms, 'customer/room-name' ) )
					done()
				} ) )
			} )
		} )

		describe( 'with assigned chat', () => {
			var chat = { id: 'chat-id' }
			beforeEach( () => new Promise( ( resolve, reject ) => {
				client.once( 'available', ( pendingChat, available ) => available( { load: 0, capacity: 1 } ) )
				client.once( 'chat.open', () => resolve() )
				operators.emit( 'assign', chat, 'room-name', error => {
					if ( error ) return reject( error )
				} )
			} ) )

			it( 'should emit chat.close from operator connection', ( done ) => {
				operators.once( 'chat.close', ( chat_id, operatorUser ) => {
					deepEqual( user, operatorUser )
					done()
				} )
				client.emit( 'chat.close', chat.id )
			} )

			it( 'should emit transfer request', () => {
				const userb = { id: 'a-user', displayName: 'Jem', status: 'online' }
				const connectionb = server.newClient()
				return connectOperator( connectionb, userb )
				.then( () => new Promise( resolve => {
					operators.once( 'chat.transfer', ( chat_id, opUser, toUser ) => {
						equal( chat_id, chat.id )
						deepEqual( opUser, op )
						deepEqual( toUser, userb )
						resolve()
					} )
					client.emit( 'chat.transfer', chat.id, userb.id )
				} ) )
			} )

			describe( 'with multiple operators', () => {
				const users = [
					{ id: 'nausica', displayName: 'nausica'},
					{ id: 'ridley', displayName: 'ridley'}
				]
				let connections = []
				beforeEach( () => users.reduce( ( promise, _user ) => {
					let connection = server.newClient()
					connections = connections.concat( connection )
					return promise.then( () => connectOperator( connection, _user ) )
				}, Promise.resolve() ) )

				it( 'should transfer to user', ( done ) => {
					operators.once( 'chat.transfer', ( id, from, to ) => {
						operators.emit( 'transfer', chat, to, () => {} )
					} )
					connections[0].client.once( 'chat.open', ( _chat ) => {
						deepEqual( _chat, chat )
						done()
					} )
					client.emit( 'chat.transfer', chat.id, users[0].id )
				} )
			} )
		} )

		it( 'should notify with updated operator list when operator joins', ( done ) => {
			const userb = { id: 'a-user', displayName: 'Jem', status: 'online' }
			const userc = { id: 'abcdefg', displayName: 'other', status: 'away' }
			server.on( 'operators.online', tick( ( identities ) => {
				equal( identities.length, 3 )
				deepEqual( map( identities, ( { displayName } ) => displayName ), [ 'furiosa', 'Jem', 'other' ] )
				deepEqual( map( identities, ( { status } ) => status ), [ 'online', 'online', 'away' ] )
				done()
			} ) )

			const connectiona = server.newClient()
			const connectionb = server.newClient()
			const connectionc = server.newClient()

			connectOperator( connectiona, userb )
			.then( () => connectOperator( connectionb, user ) )
			.then( () => connectOperator( connectionc, userc ) )
		} )
	} )

	it( 'should send init message to events', ( done ) => {
		operators.on( 'init', ( { user: u, socket: s, room } ) => {
			ok( u )
			ok( s )
			ok( room )
			equal( room, `operators/${u.id}` )
			done()
		} )
		connectOperator( server.newClient(), { id: 'a-user' } ).catch( done )
	} )

	describe( 'with multiple connections from same operator', () => {
		let connections
		let op = { id: 'user-id', displayName: 'furiosa', avatarURL: 'url', priv: 'var' }

		const connectAllClientsToChat = ( ops, chat, opUser ) => new Promise( ( resolve, reject ) => {
			parallel( map( connections, ( { client: opClient } ) => ( callback ) => {
				opClient.once( 'chat.open', ( _chat ) => callback( null, _chat ) )
			} ), ( e, chats ) => {
				if ( e ) return reject( e )
				resolve( chats )
			} )
			ops.emit( 'open', chat, `customers/${ chat.id }`, opUser )
		} )

		beforeEach( () => {
			connections = []
			return connectOperator( server.newClient(), op )
			.then( ( conn ) => {
				connections.push( conn )
				return connectOperator( server.newClient(), op )
			} )
			.then( ( conn ) => new Promise( ( resolve ) => {
				connections.push( conn )
				resolve()
			} ) )
		} )

		it( 'should not emit leave when one socket disconnects', () => {
			return new Promise( ( resolve, reject ) => {
				const [ connection ] = connections
				const { client: c, socket: s } = connection
				operators.on( 'leave', () => {
					reject( new Error( 'there are still clients connected' ) )
				} )
				c.on( 'disconnect', () => {
					resolve()
				} )
				operators.io.in( 'operators/user-id' ).clients( ( e, clients ) => {
					equal( clients.length, 2 )
					server.disconnect( { client: c, socket: s } )
				} )
			} )
		} )

		it( 'should emit chat.close to all clients in a chat', () => {
			return connectAllClientsToChat( operators, { id: 'chat-id' }, op )
			.then( () => new Promise( ( resolve, reject ) => {
				parallel( map( connections, ( { client: opClient } ) => ( callback ) => {
					opClient.once( 'chat.close', ( chat, opUser ) => callback( null, { chat, operator: opUser, client: opClient } ) )
				} ), ( e, messages ) => {
					if ( e ) reject( e )
					resolve( messages )
				} )
				operators.emit( 'close', { id: 'chat-id' }, 'customers/chat-id', op )
			} ) )
			.then( ( messages ) => {
				equal( messages.length, 2 )
			} )
		} )
	} )
} )
