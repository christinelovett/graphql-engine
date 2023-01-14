import gql from 'graphql-tag'
import { Query } from 'react-apollo'
import withData from '../config';

import PhysicianList from './PhysicianList';

// Wrap your page component with Query component from react-apollo so that appropriate data can be fetched while the page is SSRed (server-side rendoring; dynamic rendoring)

const query = gql`
	query {
	  physician {
	    id
	    name
	  }
	}
`
// Wrap your component with Query
const Index = ({ physicians } ) => {
  return (
    <Query    // <- Wrapping the main component with Query component from react-apollo
      query={ query }
      fetchPolicy={ 'cache-and-network' }
    >
      {({ loading, data, error }) => {
        if(error) {
          return (<div>Error..</div>);
        }
        return (
          <div>
            <h1>My physicians </h1>
            <PhysicianList physicians={data ? data.physician: []} />
          </div>
        );
      }}
    </Query>
  );
};

export default withData(Index)
