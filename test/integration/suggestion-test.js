import { deepEqual, ok } from 'assert'
import util, { authenticators } from './util'
import { tick } from '../tick'
import find from 'lodash/find'
import set from 'lodash/set'
import every from 'lodash/every'

const debug = require( 'debug' )( 'happychat:test:suggestion-test' )

describe( 'Chat logs', () => {
	let service
	let botUser = {
		id: 'imperator',
		dispayName: 'Furiosa',
		username: 'furiosa',
		avatarURL: 'http://example.com/furiousa'
	}

	const afterInit = ( { customer, operator, agent } ) => new Promise( ( resolve ) => {
		debug( 'setting up listeners after init' )
		operator.on( 'available', ( _, available ) => available( { capacity: 1, load: 0 } ) )
		operator.on( 'identify', callback => callback( { id: 'operator' } ) )
		const ready = { customer: false, operator: false, agent: false }
		const resolveIfReady = () => {
			if ( every( ready, value => value === true ) ) {
				debug( 'clients initialized' )
				resolve( { customer, operator, agent } )
			}
		}
		const setReady = client => {
			debug( 'setting client ready', client )
			set( ready, client, true )
			resolveIfReady()
		}
		customer.on( 'log', () => debug( 'received log' ) )
		customer.on( 'init', () => setReady( 'customer' ) )
		operator.on( 'init', () => setReady( 'operator' ) )
		agent.on( 'init', () => setReady( 'agent' ) )
	} )

	const meta = {
		suggestions: [ 1, 2, 3 ]
	}

	const replyToCustomerMessage = ( clients ) => new Promise( ( resolve ) => {
		clients.agent.on( 'message', ( message ) => {
			debug( 'replying to customers' )
			const { session_id, text, author_type } = message
			if ( author_type === 'agent' ) {
				return
			}
			clients.agent.emit( 'message', {
				id: 'message-2',
				session_id,
				text: `re: ${text}`,
				user: botUser,
				type: 'elfbot',
				meta: meta
			} )
		} )
		resolve( clients )
	} )

	const setOperatorOnline = ( clients ) => new Promise( ( resolve ) => {
		debug( 'setting operator online' )
		clients.operator.emit( 'status', 'online', () => {
			debug( 'now online' )
			resolve( clients )
		} )
	} )

	const sendCustomerMessage = ( msg ) => ( clients ) => new Promise( resolve => {
		debug( 'send customer message' )
		tick( () => {
			debug( 'emitting customer message' )
			clients.customer.emit( 'message', { id: ( new Date() ).getTime(), text: msg } )
		} )()
		resolve( clients )
	} )

	const listenForSuggestion = clients => new Promise( resolve => {
		// It could be in the log or received as the next message depending on
		// how quickly the client connects
		debug( 'listen for suggestion' )
		clients.operator.once( 'log', ( _, log ) => {
			const suggestion = find( log, ( { type } ) => type === 'elfbot' )
			if ( suggestion ) resolve( suggestion )
		} )
		clients.operator.on( 'chat.message', ( chat, message ) => {
			debug( 'received message' )
			if ( message.type === 'elfbot' ) {
				resolve( message )
			}
		} )
	} )

	beforeEach( () => {
		service = util( authenticators( { id: 'customer', session_id: 'customer-1', username: 'A-Customer' }, { id: 'operator' }, {} ) )
		return service.start()
	} )

	afterEach( () => service.stop() )

	it( 'should support meta and message type from agent', () => (
		service.startClients()
			.then( afterInit )
			.then( replyToCustomerMessage )
			.then( setOperatorOnline )
			.then( sendCustomerMessage( 'hola mundo' ) )
			.then( listenForSuggestion )
			.then( suggestion => {
				ok( suggestion )
				deepEqual( suggestion.meta, meta )
			} )
	) )
} )
