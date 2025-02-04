{-# OPTIONS_GHC -fno-warn-orphans #-}

module Hasura.Backends.DataConnector.Adapter.Execute
  (
  )
where

--------------------------------------------------------------------------------

import Data.Aeson qualified as J
import Data.Environment qualified as Env
import Data.Text.Extended (toTxt)
import Hasura.Backends.DataConnector.API (errorResponseSummary, queryCase)
import Hasura.Backends.DataConnector.API qualified as API
import Hasura.Backends.DataConnector.API.V0.ErrorResponse (ErrorResponse (..))
import Hasura.Backends.DataConnector.Adapter.ConfigTransform (transformSourceConfig)
import Hasura.Backends.DataConnector.Adapter.Types (SourceConfig (..))
import Hasura.Backends.DataConnector.Agent.Client (AgentClientT)
import Hasura.Backends.DataConnector.Plan qualified as DC
import Hasura.Base.Error (Code (..), QErr, throw400, throw400WithDetail, throw500)
import Hasura.EncJSON (EncJSON, encJFromBuilder, encJFromJValue)
import Hasura.GraphQL.Execute.Backend (BackendExecute (..), DBStepInfo (..), ExplainPlan (..))
import Hasura.GraphQL.Namespace qualified as GQL
import Hasura.Prelude
import Hasura.RQL.Types.Common qualified as RQL
import Hasura.SQL.AnyBackend (mkAnyBackend)
import Hasura.SQL.Backend (BackendType (DataConnector))
import Hasura.Session
import Hasura.Tracing (MonadTrace)
import Hasura.Tracing qualified as Tracing
import Servant.Client.Core.HasClient ((//))
import Servant.Client.Generic (genericClient)
import Witch qualified

--------------------------------------------------------------------------------

instance BackendExecute 'DataConnector where
  type PreparedQuery 'DataConnector = API.QueryRequest
  type MultiplexedQuery 'DataConnector = Void
  type ExecutionMonad 'DataConnector = AgentClientT (Tracing.TraceT (ExceptT QErr IO))

  mkDBQueryPlan UserInfo {..} env sourceName sourceConfig ir = do
    queryPlan@DC.QueryPlan {..} <- DC.mkPlan _uiSession sourceConfig ir
    transformedSourceConfig <- transformSourceConfig sourceConfig [("$session", J.toJSON _uiSession), ("$env", J.toJSON env)] env
    pure
      DBStepInfo
        { dbsiSourceName = sourceName,
          dbsiSourceConfig = transformedSourceConfig,
          dbsiPreparedQuery = Just _qpRequest,
          dbsiAction = buildQueryAction sourceName transformedSourceConfig queryPlan
        }

  mkDBQueryExplain fieldName UserInfo {..} sourceName sourceConfig ir = do
    queryPlan@DC.QueryPlan {..} <- DC.mkPlan _uiSession sourceConfig ir
    transformedSourceConfig <- transformSourceConfig sourceConfig [("$session", J.toJSON _uiSession), ("$env", J.object [])] Env.emptyEnvironment
    pure $
      mkAnyBackend @'DataConnector
        DBStepInfo
          { dbsiSourceName = sourceName,
            dbsiSourceConfig = transformedSourceConfig,
            dbsiPreparedQuery = Just _qpRequest,
            dbsiAction = buildExplainAction fieldName sourceName transformedSourceConfig queryPlan
          }
  mkDBMutationPlan _ _ _ _ _ =
    throw400 NotSupported "mkDBMutationPlan: not implemented for the Data Connector backend."
  mkLiveQuerySubscriptionPlan _ _ _ _ _ =
    throw400 NotSupported "mkLiveQuerySubscriptionPlan: not implemented for the Data Connector backend."
  mkDBStreamingSubscriptionPlan _ _ _ _ =
    throw400 NotSupported "mkLiveQuerySubscriptionPlan: not implemented for the Data Connector backend."
  mkDBRemoteRelationshipPlan _ _ _ _ _ _ _ _ =
    throw500 "mkDBRemoteRelationshipPlan: not implemented for the Data Connector backend."
  mkSubscriptionExplain _ =
    throw400 NotSupported "mkSubscriptionExplain: not implemented for the Data Connector backend."

buildQueryAction :: (MonadIO m, MonadTrace m, MonadError QErr m) => RQL.SourceName -> SourceConfig -> DC.QueryPlan -> AgentClientT m EncJSON
buildQueryAction sourceName SourceConfig {..} DC.QueryPlan {..} = do
  -- NOTE: Should this check occur during query construction in 'mkPlan'?
  when (DC.queryHasRelations _qpRequest && isNothing (API._cRelationships _scCapabilities)) $
    throw400 NotSupported "Agents must provide their own dataloader."
  let apiQueryRequest = Witch.into @API.QueryRequest _qpRequest

  queryResponse <- queryGuard =<< (genericClient // API._query) (toTxt sourceName) _scConfig apiQueryRequest
  reshapedResponse <- _qpResponseReshaper queryResponse
  pure . encJFromBuilder $ J.fromEncoding reshapedResponse
  where
    errorAction e = throw400WithDetail DataConnectorError (errorResponseSummary e) (_crDetails e)
    defaultAction = throw400 DataConnectorError "Unexpected data connector capabilities response - Unexpected Type"
    queryGuard = queryCase defaultAction pure errorAction

-- Delegates the generation to the Agent's /explain endpoint if it has that capability,
-- otherwise, returns the IR sent to the agent.
buildExplainAction :: (MonadIO m, MonadTrace m, MonadError QErr m) => GQL.RootFieldAlias -> RQL.SourceName -> SourceConfig -> DC.QueryPlan -> AgentClientT m EncJSON
buildExplainAction fieldName sourceName SourceConfig {..} DC.QueryPlan {..} =
  case API._cExplain _scCapabilities of
    Nothing -> pure . encJFromJValue . toExplainPlan fieldName $ _qpRequest
    Just API.ExplainCapabilities -> do
      let apiQueryRequest = Witch.into @API.QueryRequest _qpRequest
      explainResponse <- (genericClient // API._explain) (toTxt sourceName) _scConfig apiQueryRequest
      pure . encJFromJValue $
        ExplainPlan
          fieldName
          (Just (API._erQuery explainResponse))
          (Just (API._erLines explainResponse))

toExplainPlan :: GQL.RootFieldAlias -> API.QueryRequest -> ExplainPlan
toExplainPlan fieldName queryRequest =
  ExplainPlan fieldName (Just "") (Just [DC.renderQuery $ queryRequest])
