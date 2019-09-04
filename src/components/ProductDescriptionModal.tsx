import React, { Component } from 'react';

import { Modal } from 'antd';
import SmartBool from '@mighty-justice/smart-bool';
import { preserveNewLines } from '@mighty-justice/utils';
import parser from 'html-react-parser';
import { observer } from 'mobx-react';
import autoBindMethods from 'class-autobind-decorator';

interface IProps {
  description: string;
  isVisible: SmartBool;
}

@autoBindMethods
@observer
class ProductDescriptionModal extends Component<IProps> {
  public render () {
    const { description, isVisible } = this.props;

    return (
      <Modal
        closable
        footer={null}
        onCancel={isVisible.setFalse}
        visible={isVisible.isTrue}
      >
        {parser(preserveNewLines(description))}
      </Modal>
    );
  }
}

export default ProductDescriptionModal;
