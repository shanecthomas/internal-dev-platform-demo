import { TemplateExample } from '@backstage/plugin-scaffolder-node';
import yaml from 'yaml';

export const examples: TemplateExample[] = [
  {
    description: 'Apply a single manifest rendered inline from parameters.',
    example: yaml.stringify({
      steps: [
        {
          id: 'apply',
          name: 'Apply XStorageAccount claim',
          action: 'kubernetes:apply',
          input: {
            manifest:
              'apiVersion: storage.idp-demo.io/v1alpha1\n' +
              'kind: XStorageAccount\n' +
              'metadata:\n' +
              '  name: ${{ parameters.name }}\n' +
              '  namespace: demo\n' +
              'spec:\n' +
              '  name: ${{ parameters.name }}\n',
          },
        },
      ],
    }),
  },
];
