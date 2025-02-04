import React from 'react';
import {
  allowedMetadataTypes,
  useMetadataMigration,
  useMetadataVersion,
} from '@/features/MetadataAPI';
import { useFireNotification } from '@/new-components/Notifications';
import { DataTarget } from '@/features/Datasources';
import { useConsoleForm } from '@/new-components/Form';
import { Button } from '@/new-components/Button';
import { IndicatorCard } from '@/new-components/IndicatorCard';
import { getMetadataQuery, MetadataQueryType } from '@/metadata/queryUtils';
import { Driver } from '@/dataSources';
import { schema, Schema } from './schema';
import { FormElements } from './FormElements';
import { useDefaultValues } from './hooks';
import { getSchemaKey } from '../RemoteDBRelationshipWidget/utils';

export type LocalRelationshipWidgetProps = {
  sourceTableInfo: DataTarget;
  existingRelationshipName?: string;
  driver: Driver;
  /**
   * optional callback function, can be used to get the onComplete event, this could be a onSuccess, or onError event.
   *
   */
  onComplete?: (callback: {
    title?: string;
    message?: string;
    type: 'success' | 'error' | 'cancel';
  }) => void;
};

type MetadataPayloadType = {
  type: allowedMetadataTypes;
  args: { [key: string]: any };
  version?: number;
};

export const LocalRelationshipWidget = ({
  sourceTableInfo,
  existingRelationshipName,
  onComplete,
}: LocalRelationshipWidgetProps) => {
  // hook to fetch data for existing relationship
  const useValues = useDefaultValues({
    sourceTableInfo,
    existingRelationshipName,
  });

  const { data: defaultValues, isLoading, isError } = useValues;

  const {
    methods: { formState },
    Form,
  } = useConsoleForm({
    schema,
    options: {
      defaultValues,
    },
  });

  const { fireNotification } = useFireNotification();
  const mutation = useMetadataMigration({
    onSuccess: () => {
      const status = {
        title: 'Success!',
        message: 'Relationship saved successfully',
        type: 'success' as 'success' | 'error',
      };
      fireNotification(status);
      if (onComplete) onComplete(status);
    },
    onError: (error: Error) => {
      fireNotification({
        title: 'Error',
        message: error?.message ?? 'Error while creating the relationship',
        type: 'error',
      });
    },
  });

  const { data: resourceVersion } = useMetadataVersion();

  const updateRelationship = (values: Schema) => {
    const remote_table: {
      database?: string;
      schema?: string;
      dataset?: string;
      table: string;
    } = { ...values.destination };
    delete remote_table.database;

    const args = {
      source: sourceTableInfo.database,
      table: {
        [getSchemaKey(sourceTableInfo)]:
          (sourceTableInfo as any).dataset ?? (sourceTableInfo as any).schema,
        name: sourceTableInfo.table,
      },
      name: values.relationshipName,
      using: {
        manual_configuration: {
          remote_table: {
            [getSchemaKey(remote_table as DataTarget)]:
              (remote_table as any).dataset ?? (remote_table as any).schema,
            name: remote_table.table,
          },
          column_mapping: values.mapping,
        },
      },
    };

    const requestBody = getMetadataQuery(
      values.relationshipType as MetadataQueryType,
      sourceTableInfo.database,
      args
    );

    const body = {
      type: 'bulk' as allowedMetadataTypes,
      source: sourceTableInfo.database,
      resource_version: resourceVersion,
      args: [
        {
          type: 'pg_drop_relationship',
          args: {
            table: sourceTableInfo.table,
            source: sourceTableInfo.database,
            relationship: existingRelationshipName,
          },
        },
        requestBody,
      ],
    };

    mutation.mutate({
      query: body as MetadataPayloadType,
    });
  };

  const createRelationship = (values: Schema) => {
    const remote_table: {
      database?: string;
      schema?: string;
      dataset?: string;
      table: string;
    } = { ...values.destination };
    delete remote_table.database;

    const args = {
      source: sourceTableInfo.database,
      table: {
        [getSchemaKey(sourceTableInfo)]:
          (sourceTableInfo as any).dataset ?? (sourceTableInfo as any).schema,
        name: sourceTableInfo.table,
      },
      name: values.relationshipName,
      using: {
        manual_configuration: {
          remote_table: {
            [getSchemaKey(remote_table as DataTarget)]:
              (remote_table as any).dataset ?? (remote_table as any).schema,
            name: remote_table.table,
          },
          column_mapping: values.mapping,
        },
      },
    };
    const requestBody = getMetadataQuery(
      values.relationshipType as MetadataQueryType,
      sourceTableInfo.database,
      args
    );

    mutation.mutate({
      query: requestBody as MetadataPayloadType,
    });
  };

  const submit = (values: Record<string, unknown>) => {
    if (existingRelationshipName) {
      return updateRelationship(values as Schema);
    }
    return createRelationship(values as Schema);
  };

  if (isLoading) {
    return <div>Loading relationship data...</div>;
  }

  if (isError) {
    return <div>Something went wrong while loading relationship data</div>;
  }

  return (
    <Form onSubmit={submit} className="p-4">
      <>
        <div>
          <FormElements
            existingRelationshipName={existingRelationshipName || ''}
          />

          <Button
            mode="primary"
            type="submit"
            isLoading={mutation.isLoading}
            loadingText="Saving relationship"
            data-test="add-local-db-relationship"
          >
            Save Relationship
          </Button>
        </div>

        {!!Object.keys(formState.errors).length && (
          <IndicatorCard status="negative">
            Error saving relationship
          </IndicatorCard>
        )}
      </>
    </Form>
  );
};
