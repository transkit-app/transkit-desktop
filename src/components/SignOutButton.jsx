import React, { useState } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@nextui-org/react';
import { MdLogout } from 'react-icons/md';
import { signOut } from '../lib/transkit-cloud';

/**
 * Drop-in sign-out button with confirm modal.
 * Calls signOut({ scope: 'local' }) after user confirms.
 *
 * Props:
 *   label  — button text (default: "Sign out")
 *   size   — NextUI Button size (default: "sm")
 */
export function SignOutButton({ label = 'Sign out', size = 'sm' }) {
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [signingOut, setSigningOut] = useState(false);

    const handleConfirm = async () => {
        onClose();
        setSigningOut(true);
        try {
            await signOut();
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <>
            <Button size={size} variant='light' color='danger' isLoading={signingOut} onPress={onOpen}>
                {label}
            </Button>

            <Modal isOpen={isOpen} onClose={onClose} size='sm'>
                <ModalContent>
                    <ModalHeader className='text-sm font-semibold'>Sign out?</ModalHeader>
                    <ModalBody>
                        <p className='text-xs text-default-500'>
                            You will be signed out on this device. Other sessions will remain active.
                        </p>
                    </ModalBody>
                    <ModalFooter className='gap-2'>
                        <Button size='sm' variant='flat' onPress={onClose}>Cancel</Button>
                        <Button size='sm' color='danger' onPress={handleConfirm}>Sign out</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}
